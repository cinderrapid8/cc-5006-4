'use strict';

// Layer tip frame -> project output frame (overlay placement).
//
// A layer's tip frame (the end of its mirror/crop/zoom lineage) is placed onto
// the output canvas by a pure translation, `placement {x,y}`. Reference lines
// follow the same path: follow-lines are mapped display -> tip by lineage.js,
// then translated here exactly like the pixels they annotate. Fixed lines are
// already expressed in output coordinates and need no transform.

const guards = (typeof module !== 'undefined' && module.exports)
  ? require('./guards')
  : window.DanceTransformGuards;
const lineage = (typeof module !== 'undefined' && module.exports)
  ? require('./lineage')
  : window.DanceTransformLineage;

// Canvas transform placing a tip-space drawing at its output position.
function placementMatrix(placement) {
  guards.requireObject(placement, 'placement');
  guards.requireNumber(placement.x, 'placement.x');
  guards.requireNumber(placement.y, 'placement.y');
  return [1, 0, 0, 1, placement.x, placement.y];
}

// tip-space point -> output-frame point.
function tipToOutput(placement, x, y) {
  const M = placementMatrix(placement);
  guards.requirePoint(x, y);
  return [x + M[4], y + M[5]];
}

// output-frame point -> tip-space point (inverse placement, for hit testing).
function outputToTip(placement, x, y) {
  guards.requirePoint(x, y);
  return [x - placement.x, y - placement.y];
}

// Follow-line points defined in display space, mapped through the layer
// lineage to its tip and translated to the output canvas.
function followLineToOutput(lineageResult, placement, displayPoints) {
  guards.requireObject(lineageResult, 'lineageResult');
  const tipPoints = lineage.mapPolyline(lineageResult, lineageResult.tip, displayPoints);
  return tipPoints.map(([x, y]) => tipToOutput(placement, x, y));
}

const overlay = {
  placementMatrix,
  tipToOutput,
  outputToTip,
  followLineToOutput,
};

if (typeof module !== 'undefined' && module.exports) module.exports = overlay;
if (typeof window !== 'undefined') window.DanceTransformOverlay = overlay;
