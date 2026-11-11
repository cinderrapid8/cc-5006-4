'use strict';

// Coordinate-space lineage for one layer.
//
// Every pixel a layer can address lives in one of the documented spaces:
//   coded     : raw stored samples (media.width x media.height), possibly with
//               rotation metadata and non-square sample aspect ratio.
//   display   : upright, square-pixel image the user conceptually edits.
//               Produced by applying rotation metadata + PAR correction.
//   mirrored  : display/crop space after a horizontal flip.
//   crop:<id> : the window left after a crop step.
//   output    : the final project canvas; layers are placed into it.
//
// A transform step always names its `inSpace`: the exact tip space it consumes.
// Mirroring then cropping therefore cannot be confused with cropping then
// mirroring — the steps carry different inSpace ids, different rect
// coordinates and compile to a different filter order.
//
// Geometry between display space and any tip is kept as an affine map
//   x_tip = a*x_disp + c*y_disp + e
//   y_tip = b*x_disp + d*y_disp + f
// Only axis flips, translations and uniform zoom occur, but the full matrix is
// retained so follow-lines can be mapped exactly.

function mul(A, B) {
  // returns A o B (apply B first, then A)
  const [a1, b1, c1, d1, e1, f1] = A;
  const [a2, b2, c2, d2, e2, f2] = B;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

function applyMatrix(M, x, y) {
  return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}

function invert(M) {
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('singular space matrix');
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [
    ia, ib, ic, id,
    -(ia * e + ic * f), -(ib * e + id * f),
  ];
}

// Rounded integer dimensions for canvas/filter use; exact rational PAR is kept
// on the media descriptor for verification.
function roundDim(v) {
  return Math.round(v);
}

// Build the full space lineage of a layer from its ordered transform steps.
// Returns { spaces: Map<id, spaceRecord>, tip: id, displayW, displayH }.
function computeLineage(media, steps) {
  const spaces = new Map();
  const displayW = media.displayWidth;
  const displayH = media.displayHeight;
  spaces.set('display', {
    id: 'display', kind: 'display',
    w: displayW, h: displayH, matrix: IDENTITY.slice(),
  });

  let tip = 'display';
  for (const step of steps) {
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
      const rec = {
        id: step.id, kind: 'mirrored',
        w: parent.w, h: parent.h,
        matrix: mul(T, parent.matrix),
        parent: tip,
      };
      spaces.set(step.id, rec);
      tip = step.id;
    } else if (step.op === 'crop') {
      const r = step.rect; // coordinates in parent (tip) space
      if (r.x < 0 || r.y < 0 || r.x + r.w > parent.w || r.y + r.h > parent.h) {
        throw new Error(
          `crop ${step.id} rect ${JSON.stringify(r)} exceeds space ` +
          `"${tip}" (${parent.w}x${parent.h})`
        );
      }
      // Translation into the cropped window: x' = x - r.x
      const T = [1, 0, 0, 1, -r.x, -r.y];
      const rec = {
        id: step.id, kind: 'crop',
        w: r.w, h: r.h,
        matrix: mul(T, parent.matrix),
        parent: tip, rect: { ...r },
      };
      spaces.set(step.id, rec);
      tip = step.id;
    } else if (step.op === 'zoom') {
      // Uniform zoom of the parent tip around its centre.
      const s = step.factor;
      if (!(s > 0)) throw new Error(`zoom ${step.id} factor must be > 0`);
      const cx = (parent.w - 1) / 2;
      const cy = (parent.h - 1) / 2;
      const newW = roundDim(parent.w * s);
      const newH = roundDim(parent.h * s);
      const ncx = (newW - 1) / 2;
      const ncy = (newH - 1) / 2;
      // x' = (x - cx)*s + ncx
      const T = [s, 0, 0, s, ncx - s * cx, ncy - s * cy];
      const rec = {
        id: step.id, kind: 'zoom',
        w: newW, h: newH,
        matrix: mul(T, parent.matrix),
        parent: tip, factor: s,
      };
      spaces.set(step.id, rec);
      tip = step.id;
    } else {
      throw new Error(`unknown transform op "${step.op}"`);
    }
  }

  return { spaces, tip, displayW, displayH };
}

// Map a point expressed in display space into a named descendant space.
function mapDisplayToSpace(lineage, spaceId, x, y) {
  const rec = lineage.spaces.get(spaceId);
  if (!rec) throw new Error(`unknown space ${spaceId}`);
  return applyMatrix(rec.matrix, x, y);
}

// Inverse: point in a descendant space back to display space.
function mapSpaceToDisplay(lineage, spaceId, x, y) {
  const rec = lineage.spaces.get(spaceId);
  if (!rec) throw new Error(`unknown space ${spaceId}`);
  return applyMatrix(invert(rec.matrix), x, y);
}

// Map a polyline (array of [x,y] in display space) through to a target space.
function mapPolyline(lineage, spaceId, points) {
  return points.map(([x, y]) => mapDisplayToSpace(lineage, spaceId, x, y));
}

const spaceApi = {
  IDENTITY,
  mul,
  invert,
  applyMatrix,
  computeLineage,
  mapDisplayToSpace,
  mapSpaceToDisplay,
  mapPolyline,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = spaceApi;
}
if (typeof window !== 'undefined') {
  window.DanceSpace = spaceApi;
}
