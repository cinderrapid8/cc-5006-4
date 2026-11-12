'use strict';

// Deterministic projects shared by the pre-refactor baseline capture
// (tests/capture_baseline.js) and the post-refactor equivalence check
// (tests/equivalence.test.js). Both must build the exact same project from the
// same fixtures, so any coordinate-kernel change shows up as a frame diff.

const path = require('path');
const os = require('os');
const { probeMedia } = require('../engine/media');
const { createProject } = require('../engine/project');

const BIN = path.join(os.homedir(), '.local', 'bin');
const FX = path.resolve(__dirname, 'fixtures');

// Frame sampled for pixel/marker comparison. The moving red step marker in
// grid_master.mp4 travels 18px per frame; a fixed timestamp keeps its expected
// position reproducible.
const SAMPLE_TIME = 0.5;

// Mirror-then-zoom lineage on a canvas large enough to keep the moving marker
// and both corner anchors inside the output window.
function mirrorZoomProject() {
  const media = probeMedia(path.join(BIN, 'ffprobe'), path.join(FX, 'grid_master.mp4'));
  const p = createProject('eq_mirror_zoom');
  p.output = { width: 1920, height: 1080, fps: 30, bgColor: '#101418', duration: 2 };
  p.media = { m0: media };
  p.layers.push({
    id: 'L0', name: 'master', mediaId: 'm0',
    steps: [
      { id: 'mir', op: 'mirror', inSpace: 'display' },
      { id: 'zm', op: 'zoom', inSpace: 'mir', factor: 1.5 },
    ],
    placement: { x: 0, y: 0 }, opacity: 1,
    interval: { start: 0, end: 2 }, endPolicy: 'hide',
  });
  p.lines.push({
    id: 'lf', mode: 'follow', layerId: 'L0', inSpace: 'display',
    points: [[200, 100], [200, 600]], color: '#ffff00', thickness: 6,
  });
  p.lines.push({
    id: 'lx', mode: 'fixed', inSpace: 'output',
    points: [[960, 0], [960, 1080]], color: '#00ffff', thickness: 4,
  });
  return p;
}

module.exports = { SAMPLE_TIME, mirrorZoomProject };
