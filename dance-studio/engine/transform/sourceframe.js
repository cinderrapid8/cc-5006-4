'use strict';

// Source-pixel frame (coded) -> upright square-pixel project frame (display).
//
// This is the one place rotation metadata and the non-square pixel aspect
// ratio are turned into geometry. The renderer (filters.js) and the canvas
// preview (web/app.js) both consume the descriptor produced here, so the
// browser matrix and the ffmpeg filter chain can never drift apart.

const guards = (typeof module !== 'undefined' && module.exports)
  ? require('./guards')
  : window.DanceTransformGuards;
const matrix = (typeof module !== 'undefined' && module.exports)
  ? require('./matrix')
  : window.DanceTransformMatrix;

// ffprobe/ffmpeg rotation convention:
//   rotation 90 means the stored frame must be turned 90 degrees clockwise to
//   display upright. transpose=1 is clockwise 90, transpose=2 c-clockwise 90.
function transposeFor(rotation) {
  guards.requireNumber(rotation, 'rotation');
  switch (rotation) {
    case 0: case 360: return null;
    case 90: return 'transpose=1';
    case 180: return 'transpose=1,transpose=1';
    case 270: return 'transpose=2';
    default: throw new Error(`unsupported rotation ${rotation}`);
  }
}

// Affine matrix mapping coded sample coordinates into display-space coords.
// Rotation is applied first (it swaps the coded width/height), then the
// horizontal PAR correction scales x onto the square-pixel display width.
function codedToDisplayMatrix(media) {
  guards.requireObject(media, 'media');
  guards.requirePositive(media.width, 'media.width');
  guards.requirePositive(media.height, 'media.height');
  const sx = media.displayWidth / (media.rotation === 90 || media.rotation === 270
    ? media.height : media.width);
  const sy = media.displayHeight / (media.rotation === 90 || media.rotation === 270
    ? media.width : media.height);
  guards.requirePositive(media.parNum, 'media.parNum');
  guards.requirePositive(media.parDen, 'media.parDen');

  // Rotation-only matrices R mapping coded pixel indices to upright coded
  // indices, then PAR scale S; the returned matrix is S o R. Translations use
  // the last pixel index (width-1 / height-1), matching ffmpeg transpose.
  let R;
  switch (media.rotation) {
    case 0: case 360:
      R = [1, 0, 0, 1, 0, 0];
      break;
    case 90: // clockwise: coded (x,y) -> upright (h-1-y, x)
      R = [0, 1, -1, 0, media.height - 1, 0];
      break;
    case 180: // coded (x,y) -> upright (w-1-x, h-1-y)
      R = [-1, 0, 0, -1, media.width - 1, media.height - 1];
      break;
    case 270: // counter-clockwise: coded (x,y) -> upright (y, w-1-x)
      R = [0, -1, 1, 0, 0, media.width - 1];
      break;
    default:
      throw new Error(`unsupported rotation ${media.rotation}`);
  }
  const S = [sx, 0, 0, sy, 0, 0];
  return matrix.mul(S, R);
}

// Everything the renderer needs to lift coded samples into display space.
//   transpose : ffmpeg filter fragment (null when no rotation)
//   needsScale: a lanczos scale + setsar=1 is required (PAR or dimensions)
//   matrix    : the same mapping as a canvas affine for the browser preview
function sourceFrame(media) {
  guards.requireObject(media, 'media');
  const rotation = media.rotation || 0;
  const transpose = transposeFor(rotation);
  const uprightW = rotation === 90 || rotation === 270 ? media.height : media.width;
  const needsScale =
    media.parNum !== media.parDen || media.displayWidth !== uprightW;
  return {
    transpose,
    needsScale,
    scale: { w: media.displayWidth, h: media.displayHeight },
    matrix: codedToDisplayMatrix(media),
  };
}

const sourceFrameApi = { transposeFor, codedToDisplayMatrix, sourceFrame };

if (typeof module !== 'undefined' && module.exports) module.exports = sourceFrameApi;
if (typeof window !== 'undefined') window.DanceTransformSourceFrame = sourceFrameApi;
