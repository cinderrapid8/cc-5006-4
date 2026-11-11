'use strict';

// PPM (P6 RGB) / PAM (RGBA) frame drawing in pure Node, plus a small 5x7
// bitmap font so fixture videos carry verifiable letters (L/R labels, digits).

const FONT = {
  L: ['10000','10000','10000','10000','10000','10000','11111'],
  R: ['11110','10010','10010','11110','10100','10010','10001'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  G: ['01111','10000','10000','10111','10001','10001','01111'],
  I: ['11111','00100','00100','00100','00100','00100','11111'],
  D: ['11110','10010','10001','10001','10001','10010','11110'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  N: ['10001','11001','10101','10011','10001','10001','10001'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  O: ['01110','10001','10001','10001','10001','10001','01110'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','11011','10001'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['00110','01000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00010','01100'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  ':': ['00000','00100','00000','00000','00000','00100','00000'],
};

function makeFrame(w, h, bg = [0, 0, 0, 255]) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  return { w, h, data };
}

function setPx(f, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return;
  const i = (y * f.w + x) * 4;
  const sa = c[3] == null ? 255 : c[3];
  if (sa === 255) { f.data.set([c[0], c[1], c[2], 255], i); return; }
  const da = f.data[i + 3] / 255;
  const ia = sa / 255;
  const outA = ia + da * (1 - ia);
  if (outA < 1e-6) return;
  f.data[i] = Math.round((c[0] * ia + f.data[i] * da * (1 - ia)) / outA);
  f.data[i + 1] = Math.round((c[1] * ia + f.data[i + 1] * da * (1 - ia)) / outA);
  f.data[i + 2] = Math.round((c[2] * ia + f.data[i + 2] * da * (1 - ia)) / outA);
  f.data[i + 3] = Math.round(outA * 255);
}

function fillRect(f, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) setPx(f, xx, yy, c);
}

function drawText(f, text, x, y, scale, c) {
  let cx = x;
  for (const ch of String(text).toUpperCase()) {
    if (ch === ' ') { cx += 6 * scale; continue; }
    const glyph = FONT[ch];
    if (!glyph) { cx += 6 * scale; continue; }
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === '1') fillRect(f, cx + gx * scale, y + gy * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function textWidth(text, scale) {
  return String(text).length * 6 * scale - scale;
}

function drawGrid(f, step, color, labels) {
  for (let x = 0; x < f.w; x += step) {
    fillRect(f, x, 0, 1, f.h, color);
    if (labels) drawText(f, String(x), x + 2, 2, Math.max(1, Math.floor(step / 40)), [255, 255, 255, 255]);
  }
  for (let y = 0; y < f.h; y += step) {
    fillRect(f, 0, y, f.w, 1, color);
    if (labels) drawText(f, String(y), 2, y + 2, Math.max(1, Math.floor(step / 40)), [255, 255, 255, 255]);
  }
}

// RGB PPM (opaque fixtures)
function writePPM(f, file) {
  const out = Buffer.alloc(f.w * f.h * 3 + 100);
  let off = 0;
  off = out.write(`P6\n${f.w} ${f.h}\n255\n`, off);
  const body = Buffer.alloc(f.w * f.h * 3);
  for (let i = 0; i < f.w * f.h; i++) {
    body[i * 3] = f.data[i * 4];
    body[i * 3 + 1] = f.data[i * 4 + 1];
    body[i * 3 + 2] = f.data[i * 4 + 2];
  }
  fs.writeFileSync(file, Buffer.concat([out.slice(0, off), body]));
}

// RGBA PAM (transparent fixtures)
function writePAM(f, file) {
  const header = Buffer.from(
    `P7\nWIDTH ${f.w}\nHEIGHT ${f.h}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`, 'ascii');
  fs.writeFileSync(file, Buffer.concat([header, f.data]));
}

module.exports = {
  makeFrame, setPx, fillRect, drawText, textWidth, drawGrid, writePPM, writePAM, FONT,
};
