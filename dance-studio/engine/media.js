'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function ffprobe(ffprobeBin, file) {
  const r = spawnSync(ffprobeBin, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`ffprobe failed for ${path.basename(file)}: ${r.stderr}`);
  }
  return JSON.parse(r.stdout);
}

function parseRational(s) {
  if (!s || s === '0/0' || s === '0:0') return null;
  const [n, d] = s.split(/[/:]/).map(Number);
  if (!d) return null;
  return n / d;
}

function rotationFromMatrixText(text) {
  // ffprobe prints the 3x3 fixed-point display matrix, e.g.
  //   "0   65536  -65536 / 0  0  0 / 0  0  1073741824"
  // Strip the "00000000:" row-address prefixes ffprobe prints before parsing.
  const cleaned = text.replace(/\d{8}:/g, '');
  const nums = cleaned.match(/-?\d+/g).map(Number);
  if (nums.length < 9) return null;
  // Row-major 3x3: [a b tx; c d ty; u v w].
  const a = nums[0] / 65536, b = nums[1] / 65536;
  const c = nums[3] / 65536, d = nums[4] / 65536;
  const nearly = (v, k) => Math.abs(v - k) < 0.01;
  // Clockwise angle of the frame, derived from the display matrix.
  if (nearly(a, 1) && nearly(d, 1) && nearly(b, 0) && nearly(c, 0)) return 0;
  if (nearly(a, 0) && nearly(b, 1) && nearly(c, 0) && nearly(d, 0)) return 90;
  if (nearly(a, -1) && nearly(d, -1) && nearly(b, 0) && nearly(c, 0)) return 180;
  if (nearly(a, 0) && nearly(b, -1) && nearly(c, 0) && nearly(d, 1)) return 270;
  return null;
}

function pickRotation(stream) {
  // ffprobe's numeric "rotation" field returns 0 for exact 90-degree matrices
  // (atan2 degenerates), so parse the display matrix itself first.
  const sides = stream.side_data_list || [];
  for (const sd of sides) {
    if (sd.side_data_type === 'Display Matrix') {
      if (sd.displaymatrix) {
        const r = rotationFromMatrixText(sd.displaymatrix);
        if (r !== null) return r;
      }
      if (sd.rotation !== undefined && Number.isFinite(sd.rotation) && sd.rotation !== 0) {
        const ccw = ((sd.rotation % 360) + 360) % 360;
        return (360 - ccw) % 360;
      }
    }
  }
  const tag = stream.tags && (stream.tags.rotate || stream.tags['@rotate']);
  if (tag) return ((Number(tag) % 360) + 360) % 360;
  return 0;
}

// Returns a media descriptor: the source of truth kept inside every project.
//   { file, codec, width, height, rotation, sar, parNum, parDen,
//     displayWidth, displayHeight, duration, hasAlpha, fps, isImage }
function probeMedia(ffprobeBin, file) {
  const info = ffprobe(ffprobeBin, file);
  const v = (info.streams || []).find((s) => s.codec_type === 'video');
  if (!v) throw new Error(`no video stream in ${path.basename(file)}`);

  const width = v.width;
  const height = v.height;
  const rotation = pickRotation(v);

  // Stored sample aspect ratio (pixel aspect ratio).
  let parNum = 1, parDen = 1;
  const sar = parseRational(v.sample_aspect_ratio);
  if (sar && sar > 0) {
    const [n, d] = v.sample_aspect_ratio.split(/[/:]/).map(Number);
    parNum = n; parDen = d;
  }

  // Upright coded frame (before PAR correction).
  const swap = rotation === 90 || rotation === 270;
  const uprightW = swap ? height : width;
  const uprightH = swap ? width : height;

  // Display space = upright coded frame corrected to square pixels.
  const displayWidth = Math.round(uprightW * (parNum / parDen));
  const displayHeight = uprightH;

  const pix = v.pix_fmt || '';
  const hasAlpha = /(^|_)a($|_)|rgba|argb|bgra|abgr|yuva|alice/.test(pix);

  const fpsRat = parseRational(v.avg_frame_rate) || parseRational(v.r_frame_rate) || 25;
  const duration = info.format && info.format.duration
    ? Number(info.format.duration) : null;
  const isImage = (v.duration && Number(v.duration) <= 1 &&
    /png|mjpeg|bmp|tiff|gif/i.test(v.codec_name)) ||
    /\.(png|jpe?g|bmp|tiff?|webp)$/i.test(file);

  return {
    file,
    codec: v.codec_name,
    width,
    height,
    rotation,
    sar: v.sample_aspect_ratio || '1/1',
    parNum,
    parDen,
    displayWidth,
    displayHeight,
    duration: isImage ? null : duration,
    hasAlpha,
    fps: fpsRat,
    isImage,
    pixFmt: pix,
  };
}

module.exports = { probeMedia, pickRotation, parseRational };
