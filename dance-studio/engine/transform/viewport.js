'use strict';

// Project canvas (output frame) -> device viewport (the on-screen canvas).
//
// Preview zoom is a viewport concern only. The renderer never reads it: this
// module is the single owner of the zoom multiplication so no other component
// can re-derive the scale implicitly. "Project" coordinates are output-frame
// pixels; "device" coordinates are CSS/backing-store pixels of the canvas.

const guards = (typeof module !== 'undefined' && module.exports)
  ? require('./guards')
  : window.DanceTransformGuards;

// Backing-store size of the preview canvas for an output frame and zoom.
function deviceCanvasSize(outputWidth, outputHeight, zoom) {
  guards.requirePositive(outputWidth, 'outputWidth');
  guards.requirePositive(outputHeight, 'outputHeight');
  guards.requirePositive(zoom, 'zoom');
  return {
    width: Math.round(outputWidth * zoom),
    height: Math.round(outputHeight * zoom),
  };
}

// Affine matrix applied with ctx.setTransform before drawing the output frame.
function projectToDeviceMatrix(zoom) {
  guards.requirePositive(zoom, 'zoom');
  return [zoom, 0, 0, zoom, 0, 0];
}

// Pointer position inside the canvas element -> output-frame coordinates.
// Takes the element's bounding rect so callers do not hand-roll the division.
function deviceToProject(clientX, clientY, rect, zoom) {
  guards.requireNumber(clientX, 'clientX');
  guards.requireNumber(clientY, 'clientY');
  guards.requireObject(rect, 'rect');
  guards.requireNumber(rect.left, 'rect.left');
  guards.requireNumber(rect.top, 'rect.top');
  guards.requirePositive(zoom, 'zoom');
  return [
    (clientX - rect.left) / zoom,
    (clientY - rect.top) / zoom,
  ];
}

const viewport = { deviceCanvasSize, projectToDeviceMatrix, deviceToProject };

if (typeof module !== 'undefined' && module.exports) module.exports = viewport;
if (typeof window !== 'undefined') window.DanceTransformViewport = viewport;
