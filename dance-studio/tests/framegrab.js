'use strict';

// Extract a single frame from a rendered video into raw RGBA pixels for
// assertion-based verification (no image libraries required).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function grabFrame(binDir, video, timeSec, { includeAlpha = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grab-'));
  const out = path.join(tmp, includeAlpha ? 'f.pam' : 'f.ppm');
  const args = ['-hide_banner', '-nostdin', '-y', '-ss', String(timeSec),
    '-i', video, '-frames:v', '1'];
  if (includeAlpha) args.push('-pix_fmt', 'rgba', '-f', 'pam', out);
  else args.push('-pix_fmt', 'rgb24', '-f', 'image2', '-vcodec', 'ppm', out);
  const r = spawnSync(path.join(binDir, 'ffmpeg'), args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`grabFrame failed: ${r.stderr}`);
  const buf = fs.readFileSync(out);
  let headerEnd, width, height;
  const pamEnd = buf.indexOf(Buffer.from('ENDHDR\n'));
  if (pamEnd !== -1) {
    // P7 PAM: explicit WIDTH/HEIGHT lines
    headerEnd = pamEnd + 'ENDHDR\n'.length;
    const header = buf.slice(0, headerEnd).toString();
    width = Number(/WIDTH (\d+)/.exec(header)[1]);
    height = Number(/HEIGHT (\d+)/.exec(header)[1]);
  } else {
    // P6 PPM: "P6\n<width> <height>\n<maxval>\n" — skip the P6 magic token.
    const marker = Buffer.from('\n255\n');
    headerEnd = buf.indexOf(marker) + marker.length;
    const sizeM = /\n(\d+)\s+(\d+)\n/.exec(buf.slice(0, headerEnd).toString());
    width = Number(sizeM[1]);
    height = Number(sizeM[2]);
  }
  const depth = includeAlpha ? 4 : 3;
  return { w: width, h: height, depth, data: buf.slice(headerEnd) };
}

function px(frame, x, y) {
  const i = (y * frame.w + x) * frame.depth;
  return [frame.data[i], frame.data[i + 1], frame.data[i + 2],
    frame.depth === 4 ? frame.data[i + 3] : 255];
}

// Average colour of a small patch; robust against 4:2:0 chroma bleed.
function patch(frame, x, y, r = 4) {
  let rs = 0, gs = 0, bs = 0, as = 0, n = 0;
  for (let yy = y - r; yy <= y + r; yy++) {
    for (let xx = x - r; xx <= x + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= frame.w || yy >= frame.h) continue;
      const c = px(frame, xx, yy);
      rs += c[0]; gs += c[1]; bs += c[2]; as += c[3]; n++;
    }
  }
  return [rs / n, gs / n, bs / n, as / n];
}

function isNear(c, target, tol = 40) {
  return Math.abs(c[0] - target[0]) < tol &&
    Math.abs(c[1] - target[1]) < tol &&
    Math.abs(c[2] - target[2]) < tol;
}

// Locate the centroid of pixels near a target colour within a region.
function findColor(frame, target, region, tol = 40) {
  const [x0, y0, x1, y1] = region;
  let sx = 0, sy = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (isNear(px(frame, x, y), target, tol)) { sx += x; sy += y; n++; }
    }
  }
  return n ? { x: sx / n, y: sy / n, count: n } : null;
}

module.exports = { grabFrame, px, patch, isNear, findColor };
