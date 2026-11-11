'use strict';

// Inject real display-matrix rotation metadata into an MP4 by patching the
// tkhd box (ffmpeg 7's mov muxer does not write rotation itself). The coded
// pixels stay untouched — this is exactly the "rotation metadata" case real
// phone footage presents.
const fs = require('fs');

// Matrix values are 16.16 fixed point; the ninth element is always 1<<30.
// Clockwise 90 in display-matrix terms is a=0,b=1,c=-1,d=0 (Apple rotation=90).
const MATRICES = {
  0: [1 << 16, 0, 0, 1 << 16, 0, 0],
  90: [0, 1 << 16, -(1 << 16), 0, 0, 0],
  180: [-(1 << 16), 0, 0, -(1 << 16), 0, 0],
  270: [0, -(1 << 16), 1 << 16, 0, 0, 0],
};

function findBoxes(buf, type, from = 0, end = buf.length, out = []) {
  let off = from;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const t = buf.toString('ascii', off + 4, off + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(off + 8));
    if (size < 8 || off + size > end) break;
    if (t === type) out.push(off);
    if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta'].includes(t)) {
      findBoxes(buf, type, off + 8, off + size, out);
    }
    off += size;
  }
  return out;
}

function patchRotation(file, degrees) {
  const buf = fs.readFileSync(file);
  const tkhdOffsets = findBoxes(buf, 'tkhd');
  if (!tkhdOffsets.length) throw new Error('no tkhd box found');
  const version = buf[tkhdOffsets[0] + 8];
  // tkhd layout after box header: version+flags(4), creation/modification
  // (8 or 16), trackID(4), reserved(4), duration(4 or 8), reserved(8),
  // layer(2), altGroup(2), volume(2), reserved(2), matrix(36).
  const matrixOff = tkhdOffsets[0] + 8 + 4 + (version === 1 ? 16 : 8) +
    4 + 4 + (version === 1 ? 8 : 4) + 8 + 2 + 2 + 2 + 2;
  const m = MATRICES[((degrees % 360) + 360) % 360];
  if (!m) throw new Error(`unsupported rotation ${degrees}`);
  m.forEach((v, i) => buf.writeInt32BE(v, matrixOff + i * 4));
  buf.writeUInt32BE(1 << 30, matrixOff + 8 * 4); // fixed-point unity element
  fs.writeFileSync(file, buf);
  return file;
}

module.exports = { patchRotation, findBoxes };
