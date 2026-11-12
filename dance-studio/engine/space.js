'use strict';

// Compatibility adapter for the legacy coordinate entry point.
//
// The composable kernel now lives in engine/transform/ (source pixels vs
// project frames vs device viewport). This file keeps the historical
// DanceSpace API — including the browser global and the exact error strings
// existing projects/tests rely on — and forwards every call to the kernel.
// New code should import engine/transform directly.

const transform = (typeof module !== 'undefined' && module.exports)
  ? require('./transform')
  : window.DanceTransform;

const { matrix, lineage } = transform;

const spaceApi = {
  // Legacy matrix primitives (identical semantics, delegated to the kernel).
  IDENTITY: matrix.IDENTITY,
  mul: matrix.mul,
  invert: matrix.invert,
  applyMatrix: matrix.applyMatrix,
  // Legacy lineage entry points.
  computeLineage: lineage.computeLineage,
  mapDisplayToSpace: lineage.mapDisplayToSpace,
  mapSpaceToDisplay: lineage.mapSpaceToDisplay,
  mapPolyline: lineage.mapPolyline,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = spaceApi;
}
if (typeof window !== 'undefined') {
  window.DanceSpace = spaceApi;
}
