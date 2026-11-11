'use strict';

// End-to-end test through the running HTTP server: upload real fixtures,
// build a project via the same JSON the browser sends, save it, kick off a
// background render job, poll to completion and download the composite.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { createServer } = require('../engine/server');
const { grabFrame, isNear, patch } = require('./framegrab');

const BIN = path.join(os.homedir(), '.local', 'bin');
const FX = path.resolve(__dirname, 'fixtures');
const PORT = 8099;
const BASE = `http://localhost:${PORT}`;

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        resolve({ status: res.statusCode, body: ct.includes('json') ? JSON.parse(raw.toString() || '{}') : raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipart(fileFieldName, file) {
  const boundary = '----danceboundary' + Date.now();
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileFieldName}"; ` +
    `filename="${path.basename(file)}"\r\nContent-Type: video/mp4\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat([head, fs.readFileSync(file), tail]) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

async function main() {
  const server = createServer();
  await new Promise((r) => server.listen(PORT, r));
  try {
    // 1. upload both fixtures
    const up1 = multipart('file', path.join(FX, 'grid_master.mp4'));
    const r1 = await request('POST', '/api/media', up1.body, { 'Content-Type': up1.contentType });
    assert.strictEqual(r1.status, 200);
    const masterId = r1.body.mediaId;
    assert.strictEqual(r1.body.media.displayWidth, 1280);

    const up2 = multipart('file', path.join(FX, 'portrait_rot.mp4'));
    const r2 = await request('POST', '/api/media', up2.body, { 'Content-Type': up2.contentType });
    assert.strictEqual(r2.body.media.rotation, 90, 'rotation metadata must survive upload');
    assert.strictEqual(r2.body.media.displayWidth, 1080);
    console.log('  PASS  upload preserves rotation and dimensions');

    // 2. list media
    const list = await request('GET', '/api/media');
    assert.ok(list.body.media.length >= 2);
    console.log('  PASS  media listing works');

    // 3. build a full project (mirror+crop ordered steps, follow + fixed lines)
    const portraitId = r2.body.mediaId;
    const project = {
      schemaVersion: 1,
      name: 'e2e_dance',
      output: { width: 1280, height: 720, fps: 30, bgColor: '#101418', duration: 2 },
      media: {
        m0: r1.body.media,
        m1: r2.body.media,
      },
      layers: [
        {
          id: 'L0', name: 'master', mediaId: 'm0',
          steps: [
            { id: 'm', op: 'mirror', inSpace: 'display' },
            { id: 'c', op: 'crop', inSpace: 'm', rect: { x: 400, y: 0, w: 600, h: 720 } },
          ],
          placement: { x: 0, y: 0 }, opacity: 1,
          interval: { start: 0, end: 2 }, endPolicy: 'hide',
        },
        {
          id: 'L1', name: 'phone-pip', mediaId: 'm1',
          steps: [], placement: { x: 900, y: 60 }, opacity: 0.9,
          interval: { start: 0.3, end: 2 }, endPolicy: 'freeze',
        },
      ],
      lines: [
        { id: 'g1', mode: 'follow', layerId: 'L0', inSpace: 'display',
          points: [[100, 80], [100, 640]], color: '#ffff00', thickness: 5 },
        { id: 'g2', mode: 'fixed', inSpace: 'output',
          points: [[640, 0], [640, 720]], color: '#00ffff', thickness: 4 },
      ],
      ui: { previewZoom: 1 },
    };

    // 4. save project
    const saved = await request('POST', '/api/projects', JSON.stringify(project),
      { 'Content-Type': 'application/json' });
    assert.strictEqual(saved.status, 200);
    console.log('  PASS  project saved:', saved.body.saved);

    // 5. load it back
    const loaded = await request('GET', `/api/projects/${saved.body.saved}`);
    assert.strictEqual(loaded.body.layers[0].steps[1].inSpace, 'm');
    assert.strictEqual(loaded.body.media[portraitId]?.rotation || loaded.body.media.m1.rotation, 90);
    console.log('  PASS  project reload preserves spaces and metadata');

    // 6. start background render
    const job = await request('POST', '/api/render', JSON.stringify(project),
      { 'Content-Type': 'application/json' });
    assert.strictEqual(job.status, 202);
    const { jobId } = job.body;

    let finalJob;
    for (let i = 0; i < 60; i++) {
      const s = await request('GET', `/api/render/jobs/${jobId}`);
      if (s.body.status !== 'running') { finalJob = s.body; break; }
      await sleep(500);
    }
    assert.ok(finalJob, 'render job never finished');
    assert.strictEqual(finalJob.status, 'done', finalJob.error);
    console.log('  PASS  background render completed');

    // 7. download the composite and verify pixels
    const dl = await request('GET', finalJob.output);
    assert.strictEqual(dl.status, 200);
    const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')), 'composite.mp4');
    fs.writeFileSync(outFile, dl.body);

    const frame = grabFrame(BIN, outFile, 1.0);
    assert.strictEqual(frame.w, 1280);
    assert.strictEqual(frame.h, 720);
    // fixed cyan centre line at x=640
    const centre = patch(frame, 640, 360, 3);
    assert.ok(centre[2] > 150 && centre[1] > 150, `fixed line missing: ${centre}`);
    // phone PIP (portrait 1080x1920 scaled? placed at 900,60) green anchor visible
    const pipGreen = patch(frame, 900 + 20, 60 + 20, 4);
    assert.ok(isNear(pipGreen, [0, 255, 0], 50), `PIP green anchor missing: ${pipGreen}`);
    console.log('  PASS  downloaded composite has fixed line and portrait PIP');

    // 8. static file serving of the editor and space module
    const page = await request('GET', '/');
    assert.strictEqual(page.status, 200);
    const mod = await request('GET', '/engine/space.js');
    assert.strictEqual(mod.status, 200);
    console.log('  PASS  editor and browser space module are served');

    console.log(`\n${passed + 3}/${passed + 3} e2e checks passed`);
  } finally {
    server.close();
  }
}

main().catch((e) => { console.error('E2E FAIL:', e); process.exit(1); });
