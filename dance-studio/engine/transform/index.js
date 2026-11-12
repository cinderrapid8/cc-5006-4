'use strict';

// Composable coordinate-transform kernel.
//
// Three explicit frames run through every consumer:
//   source pixels : coded samples (media.width x media.height), possibly with
//                   rotation metadata and non-square PAR — sourceframe.js
//   project frame : upright square-pixel display space, per-layer tip spaces
//                   and the output canvas — lineage.js + overlay.js
//   display window: the on-screen preview canvas at the current preview zoom
//                   — viewport.js
//
// Render (engine/filters.js, engine/render.js), selection/hit-testing
// (web/app.js) and export all call these interfaces instead of re-deriving
// scales or flips locally. engine/space.js stays as a thin compatibility
// adapter over this package for the legacy DanceSpace entry points.

const guards = require('./guards');
const matrix = require('./matrix');
const lineage = require('./lineage');
const sourceframe = require('./sourceframe');
const viewport = require('./viewport');
const overlay = require('./overlay');

const transform = {
  // Frame contracts
  SOURCE_FRAME: 'coded',
  PROJECT_FRAMES: ['display', 'output'],
  DEVICE_FRAME: 'device',
  // Submodules
  guards,
  matrix,
  lineage,
  sourceframe,
  viewport,
  overlay,
  // Convenience re-exports for the most common kernel calls
  IDENTITY: matrix.IDENTITY,
  computeLineage: lineage.computeLineage,
  mapDisplayToSpace: lineage.mapDisplayToSpace,
  mapSpaceToDisplay: lineage.mapSpaceToDisplay,
  mapPolyline: lineage.mapPolyline,
  sourceFrame: sourceframe.sourceFrame,
  codedToDisplayMatrix: sourceframe.codedToDisplayMatrix,
  transposeFor: sourceframe.transposeFor,
  deviceCanvasSize: viewport.deviceCanvasSize,
  projectToDeviceMatrix: viewport.projectToDeviceMatrix,
  deviceToProject: viewport.deviceToProject,
  placementMatrix: overlay.placementMatrix,
  tipToOutput: overlay.tipToOutput,
  outputToTip: overlay.outputToTip,
  followLineToOutput: overlay.followLineToOutput,
};

module.exports = transform;
