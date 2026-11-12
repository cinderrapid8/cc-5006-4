'use strict';

// Transform-step lineage for one layer's project frames.
//
// The frames this module connects are project frames only:
//   display   : upright, square-pixel image the user conceptually edits
//   mirror/crop/zoom step ids : the tip frame each ordered step produces
// The coded source frame belongs to sourceframe.js; the output canvas and the
// device viewport belong to overlay.js / viewport.js.
//
// A step always names its `inSpace`: the exact tip frame it consumes. Mirror
// then crop and crop then mirror are therefore different chains with different
// rect coordinates and compile to a different ffmpeg filter order.

const guards = (typeof module !== 'undefined' && module.exports)
  ? require('./guards')
  : window.DanceTransformGuards;
const matrix = (typeof module !== 'undefined' && module.exports)
  ? require('./matrix')
  : window.DanceTransformMatrix;

const { IDENTITY, mul, applyMatrix, invert } = matrix;

// Rounded integer dimensions for canvas/filter use; exact rational PAR stays
// on the media descriptor for verification.
function roundDim(v) {
  return Math.round(v);
}

// Build the full frame lineage of a layer from its ordered transform steps.
// Returns { spaces: Map<id, spaceRecord>, tip: id, displayW, displayH }.
function computeLineage(media, steps) {
  guards.requireObject(media, 'media');
  guards.requirePositive(media.displayWidth, 'media.displayWidth');
  guards.requirePositive(media.displayHeight, 'media.displayHeight');
  if (!Array.isArray(steps)) throw new TypeError('steps must be an array');

  const spaces = new Map();
  const displayW = media.displayWidth;
  const displayH = media.displayHeight;
  spaces.set('display', {
    id: 'display', kind: 'display',
    w: displayW, h: displayH, matrix: IDENTITY.slice(),
  });

  let tip = 'display';
  for (const step of steps) {
    guards.requireObject(step, 'step');
    const parent = spaces.get(tip);
    if (!parent) throw new Error(`unknown parent space ${tip}`);
    if (step.inSpace !== tip) {
      throw new Error(
        `step ${step.id} declares inSpace "${step.inSpace}" but current tip ` +
        `is "${tip}" — coordinates must be expressed in the current space`
      );
    }

    if (step.op === 'mirror') {
      // Horizontal flip inside the parent tip: x' = (W-1) - x
      const T = [-1, 0, 0, 1, parent.w - 1, 0];
      spaces.set(step.id, {
        id: step.id, kind: 'mirrored',
        w: parent.w, h: parent.h,
        matrix: mul(T, parent.matrix),
        parent: tip,
      });
      tip = step.id;
    } else if (step.op === 'crop') {
      const r = step.rect; // coordinates in parent (tip) space
      guards.requireObject(r, 'crop rect');
      guards.requireNonNegative(r.x, 'crop rect.x');
      guards.requireNonNegative(r.y, 'crop rect.y');
      guards.requirePositive(r.w, 'crop rect.w');
      guards.requirePositive(r.h, 'crop rect.h');
      if (r.x < 0 || r.y < 0 || r.x + r.w > parent.w || r.y + r.h > parent.h) {
        throw new Error(
          `crop ${step.id} rect ${JSON.stringify(r)} exceeds space ` +
          `"${tip}" (${parent.w}x${parent.h})`
        );
      }
      // Translation into the cropped window: x' = x - r.x
      const T = [1, 0, 0, 1, -r.x, -r.y];
      spaces.set(step.id, {
        id: step.id, kind: 'crop',
        w: r.w, h: r.h,
        matrix: mul(T, parent.matrix),
        parent: tip, rect: { ...r },
      });
      tip = step.id;
    } else if (step.op === 'zoom') {
      // Uniform zoom of the parent tip around its centre.
      const s = step.factor;
      guards.requirePositive(s, 'zoom factor');
      const cx = (parent.w - 1) / 2;
      const cy = (parent.h - 1) / 2;
      const newW = roundDim(parent.w * s);
      const newH = roundDim(parent.h * s);
      const ncx = (newW - 1) / 2;
      const ncy = (newH - 1) / 2;
      // x' = (x - cx)*s + ncx
      const T = [s, 0, 0, s, ncx - s * cx, ncy - s * cy];
      spaces.set(step.id, {
        id: step.id, kind: 'zoom',
        w: newW, h: newH,
        matrix: mul(T, parent.matrix),
        parent: tip, factor: s,
      });
      tip = step.id;
    } else {
      throw new Error(`unknown transform op "${step.op}"`);
    }
  }

  return { spaces, tip, displayW, displayH };
}

function spaceRecord(lineage, spaceId) {
  guards.requireObject(lineage, 'lineage');
  const rec = lineage.spaces.get(spaceId);
  if (!rec) throw new Error(`unknown space ${spaceId}`);
  return rec;
}

// Point expressed in display space mapped into a named descendant space.
function mapDisplayToSpace(lineage, spaceId, x, y) {
  guards.requirePoint(x, y);
  return applyMatrix(spaceRecord(lineage, spaceId).matrix, x, y);
}

// Inverse: point in a descendant space back to display space.
function mapSpaceToDisplay(lineage, spaceId, x, y) {
  guards.requirePoint(x, y);
  return applyMatrix(invert(spaceRecord(lineage, spaceId).matrix), x, y);
}

// Polyline (array of [x,y] in display space) through to a target space.
function mapPolyline(lineage, spaceId, points) {
  if (!Array.isArray(points)) throw new TypeError('points must be an array');
  return points.map(([x, y]) => mapDisplayToSpace(lineage, spaceId, x, y));
}

const lineageApi = {
  computeLineage,
  spaceRecord,
  mapDisplayToSpace,
  mapSpaceToDisplay,
  mapPolyline,
};

if (typeof module !== 'undefined' && module.exports) module.exports = lineageApi;
if (typeof window !== 'undefined') window.DanceTransformLineage = lineageApi;
