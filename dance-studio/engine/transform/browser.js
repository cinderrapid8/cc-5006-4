'use strict';

// Browser assembly of the composable coordinate-transform kernel.
//
// The submodules are plain UMD files that attach named globals; this entry
// mirrors engine/transform/index.js for Node and exposes the same surface as
// window.DanceTransform. Loaded after every submodule and before space.js.

(function () {
  const g = window;
  const transform = {
    SOURCE_FRAME: 'coded',
    PROJECT_FRAMES: ['display', 'output'],
    DEVICE_FRAME: 'device',
    guards: g.DanceTransformGuards,
    matrix: g.DanceTransformMatrix,
    lineage: g.DanceTransformLineage,
    sourceframe: g.DanceTransformSourceFrame,
    viewport: g.DanceTransformViewport,
    overlay: g.DanceTransformOverlay,
    IDENTITY: g.DanceTransformMatrix.IDENTITY,
    computeLineage: g.DanceTransformLineage.computeLineage,
    mapDisplayToSpace: g.DanceTransformLineage.mapDisplayToSpace,
    mapSpaceToDisplay: g.DanceTransformLineage.mapSpaceToDisplay,
    mapPolyline: g.DanceTransformLineage.mapPolyline,
    sourceFrame: g.DanceTransformSourceFrame.sourceFrame,
    codedToDisplayMatrix: g.DanceTransformSourceFrame.codedToDisplayMatrix,
    transposeFor: g.DanceTransformSourceFrame.transposeFor,
    deviceCanvasSize: g.DanceTransformViewport.deviceCanvasSize,
    projectToDeviceMatrix: g.DanceTransformViewport.projectToDeviceMatrix,
    deviceToProject: g.DanceTransformViewport.deviceToProject,
    placementMatrix: g.DanceTransformOverlay.placementMatrix,
    tipToOutput: g.DanceTransformOverlay.tipToOutput,
    outputToTip: g.DanceTransformOverlay.outputToTip,
    followLineToOutput: g.DanceTransformOverlay.followLineToOutput,
  };
  g.DanceTransform = transform;
})();
