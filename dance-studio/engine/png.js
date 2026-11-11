'use strict';

const zlib = require('zlib');

// Minimal RGBA8 PNG encoder (no native deps). Reference lines are rendered to
// these images and overlaid as straight-alpha layers, so semi-transparent
// pixels composite correctly instead of producing dark halos.

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function hexColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#ff0000');
  if (!m) return [255, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// rgba: array-like of width*height*4 bytes.
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeCanvas(w, h) {
  return { w, h, data: Buffer.alloc(w * h * 4) };
}

function setPx(cv, x, y, [r, g, b], a) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 4;
  // Source-over blend onto whatever is already on the line canvas.
  const ia = a / 255;
  cv.data[i] = Math.round(cv.data[i] * (1 - ia) + r * ia);
  cv.data[i + 1] = Math.round(cv.data[i + 1] * (1 - ia) + g * ia);
  cv.data[i + 2] = Math.round(cv.data[i + 2] * (1 - ia) + b * ia);
  cv.data[i + 3] = Math.min(255, cv.data[i + 3] + a);
}

// Stroke a polyline with round-ish coverage (modified Xiaolin Wu lite:
// supersample 4x per pixel for anti-aliased edges without a dark fringe).
function strokePolyline(cv, points, thickness, colorHex, alpha) {
  if (points.length < 2) return;
  const [r, g, b] = hexColor(colorHex);
  const a255 = Math.round(255 * alpha);
  const SS = 4;
  const half = thickness / 2;
  for (let s = 0; s < points.length - 1; s++) {
    let [x0, y0] = points[s];
    let [x1, y1] = points[s + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = -dy / len, ny = dx / len;
    const steps = Math.ceil(len * SS) + 1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const cx = x0 + dx * t, cy = y0 + dy * t;
      for (let u = -Math.ceil(half); u <= Math.ceil(half); u++) {
        const px = cx + nx * u, py = cy + ny * u;
        const xMin = Math.floor(px - half), xMax = Math.ceil(px + half);
        const yMin = Math.floor(py - half), yMax = Math.ceil(py + half);
        for (let yy = yMin; yy <= yMax; yy++) {
          for (let xx = xMin; xx <= xMax; xx++) {
            let hits = 0;
            for (let sy = 0; sy < SS; sy++) {
              for (let sx = 0; sx < SS; sx++) {
                const qx = xx + (sx + 0.5) / SS;
                const qy = yy + (sy + 0.5) / SS;
                if (Math.hypot(qx - px, qy - py) <= half) hits++;
              }
            }
            if (hits) setPx(cv, xx, yy, [r, g, b], (a255 * hits) / (SS * SS));
          }
        }
      }
    }
  }
}

module.exports = { encodePng, makeCanvas, strokePolyline, hexColor };
