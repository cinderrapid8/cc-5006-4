'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const { probeMedia } = require('./media');
const { createProject, validateProject, saveProject, loadProject } = require('./project');
const { render } = require('./render');

const BIN = path.join(os.homedir(), '.local', 'bin');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const MEDIA_DIR = path.join(DATA, 'media');
const PROJECT_DIR = path.join(DATA, 'projects');
const RENDER_DIR = path.join(DATA, 'renders');
const WEB_DIR = path.join(ROOT, 'web');

for (const d of [MEDIA_DIR, PROJECT_DIR, RENDER_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

const jobs = new Map(); // id -> { status, progress, log, output, error }
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Minimal multipart/form-data parser sufficient for media uploads.
function parseMultipart(buf, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) throw new Error('missing multipart boundary');
  const delim = Buffer.from(`--${boundary[1] || boundary[2]}`);
  const parts = [];
  let start = buf.indexOf(delim);
  while (start !== -1) {
    const headerStart = start + delim.length + 2;
    const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const headers = buf.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const next = buf.indexOf(delim, dataStart);
    if (next === -1) break;
    const data = buf.slice(dataStart, next - 2); // strip CRLF before boundary
    const nameM = /name="([^"]+)"/.exec(headers);
    const fileM = /filename="([^"]*)"/.exec(headers);
    parts.push({
      name: nameM ? nameM[1] : null,
      filename: fileM ? fileM[1] : null,
      headers,
      data,
    });
    start = next;
  }
  return parts;
}

function safeName(name) {
  return path.basename(name).replace(/[^\w.\-]+/g, '_');
}

async function handleApi(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  // ---- media upload + probe ----
  if (seg[1] === 'media' && method === 'POST') {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) return sendJson(res, 400, { error: 'expected multipart' });
    const body = await readBody(req);
    const parts = parseMultipart(body, ct);
    const filePart = parts.find((p) => p.filename);
    if (!filePart) return sendJson(res, 400, { error: 'no file part' });
    const id = `${Date.now()}_${safeName(filePart.filename)}`;
    const dest = path.join(MEDIA_DIR, id);
    fs.writeFileSync(dest, filePart.data);
    try {
      const media = probeMedia(path.join(BIN, 'ffprobe'), dest);
      media.id = id;
      return sendJson(res, 200, { mediaId: id, media });
    } catch (e) {
      fs.unlinkSync(dest);
      return sendJson(res, 400, { error: e.message });
    }
  }

  // ---- list media ----
  if (seg[1] === 'media' && method === 'GET') {
    const items = fs.readdirSync(MEDIA_DIR).map((id) => {
      try {
        const m = probeMedia(path.join(BIN, 'ffprobe'), path.join(MEDIA_DIR, id));
        return { mediaId: id, media: m };
      } catch { return null; }
    }).filter(Boolean);
    return sendJson(res, 200, { media: items });
  }

  // ---- project save ----
  if (seg[1] === 'projects' && method === 'POST') {
    const project = JSON.parse((await readBody(req)).toString());
    validateProject(project);
    const file = saveProject(PROJECT_DIR, project);
    return sendJson(res, 200, { saved: path.basename(file) });
  }

  // ---- project list / load ----
  if (seg[1] === 'projects' && method === 'GET') {
    const files = fs.readdirSync(PROJECT_DIR).filter((f) => f.endsWith('.json'));
    if (seg[2]) {
      const file = path.join(PROJECT_DIR, safeName(seg[2]));
      if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, loadProject(file));
    }
    return sendJson(res, 200, { projects: files });
  }

  // ---- render: start a background job ----
  if (seg[1] === 'render' && method === 'POST') {
    const project = JSON.parse((await readBody(req)).toString());
    validateProject(project);
    const jobId = `job_${Date.now()}`;
    const ext = (project.output.container || 'mp4') === 'webm' ? 'webm' : 'mp4';
    const output = path.join(RENDER_DIR, `${jobId}.${ext}`);
    jobs.set(jobId, { id: jobId, status: 'running', log: '', output: null, error: null });
    // Persist the exact project that produced each render.
    saveProject(PROJECT_DIR, { ...project, name: `${jobId}_project` });
    render(project, output, {
      binDir: BIN,
      onLog: (level, msg) => {
        const job = jobs.get(jobId);
        if (job) job.log = (job.log + msg + '\n').slice(-20000);
      },
    }).then(() => {
      const job = jobs.get(jobId);
      job.status = 'done';
      job.output = `/renders/${path.basename(output)}`;
    }).catch((e) => {
      const job = jobs.get(jobId);
      job.status = 'error';
      job.error = e.message;
    });
    return sendJson(res, 202, { jobId });
  }

  // ---- render job status ----
  if (seg[1] === 'render' && seg[2] === 'jobs' && method === 'GET') {
    const job = jobs.get(seg[3]);
    if (!job) return sendJson(res, 404, { error: 'unknown job' });
    return sendJson(res, 200, job);
  }

  return sendJson(res, 404, { error: 'no such api route' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR)) {
    res.writeHead(403); return res.end('forbidden');
  }
  // Rendered output downloads live under /renders.
  if (url.pathname.startsWith('/renders/')) {
    return serveFile(res, path.join(RENDER_DIR, safeName(url.pathname.slice('/renders/'.length))));
  }
  if (url.pathname.startsWith('/media/')) {
    return serveFile(res, path.join(MEDIA_DIR, safeName(url.pathname.slice('/media/'.length))));
  }
  // Browser build of the pure space-math module.
  if (url.pathname === '/engine/space.js') {
    return serveFile(res, path.join(ROOT, 'engine', 'space.js'));
  }
  serveFile(res, file);
}

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end('not found');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((e) => sendJson(res, 500, { error: e.message }));
    } else {
      serveStatic(req, res, url);
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  createServer().listen(port, () => {
    console.log(`dance studio on http://localhost:${port}`);
  });
}

module.exports = { createServer, parseMultipart };
