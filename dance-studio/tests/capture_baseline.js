'use strict';

// Pre-refactor evidence capture. Run once against the baseline coordinate
// kernel (engine/space.js at the Task baseline commit). The frames and the
// measured marker/anchor values are checked into tests/baseline/ and become
// the equivalence boundary that the refactored transform kernel must reproduce.
//
//   node tests/capture_baseline.js
//
// "Reopen" is exercised by saving the project to disk, loading it through the
// same validate/load path the browser uses, and rendering that loaded copy.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { render } = require('../engine/render');
const { saveProject, loadProject } = require('../engine/project');
const { grabFrame, findColor, patch } = require('./framegrab');
const { SAMPLE_TIME, mirrorZoomProject } = require('./equivalence_projects');

const BIN = path.join(os.homedir(), '.local', 'bin');
const BASELINE_DIR = path.resolve(__dirname, 'baseline');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'dance-baseline-'));

const RED = [230, 60, 60];
const GREEN = [0, 255, 0];
const MAGENTA = [255, 0, 255];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function measure(frame) {
  // After mirror the marker (display x ~350 at t=0.5) lands at display x=929;
  // the 1.5x zoom maps that into the left half of the output.
  const marker = findColor(frame, RED, [960, 700, 1600, 960], 50);
  return {
    frame: { w: frame.w, h: frame.h, bytes: frame.data.length, sha256: sha256(frame.data) },
    marker: marker ? { x: marker.x, y: marker.y, count: marker.count } : null,
    // mirrored green anchor lands at the tip's top-right; under 1.5x zoom and
    // zero placement that is output (1919*1.5, 12*1.5) = (2878, 18) — outside
    // the 1920-wide canvas, so sample the anchor that stays inside instead:
    // the original top-right (magenta source) mirrors to top-left.
    anchorTopLeft: patch(frame, 18, 18, 4),
    anchorBottomLeft: patch(frame, 18, 1062, 4),
  };
}

async function main() {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const project = mirrorZoomProject();

  // First render: straight from the in-memory project.
  const out1 = path.join(WORK, 'mirror_zoom.mp4');
  await render(project, out1, { binDir: BIN });
  const frame1 = grabFrame(BIN, out1, SAMPLE_TIME);
  const ppm1 = path.join(BASELINE_DIR, 'mirror_zoom.ppm');
  fs.writeFileSync(ppm1, frame1.data.length ? frameToPpm(frame1) : frame1.data);

  // Reopen: persist -> load through validation -> render again.
  const savedFile = saveProject(WORK, project);
  const reopened = loadProject(savedFile);
  const out2 = path.join(WORK, 'mirror_zoom_reopen.mp4');
  await render(reopened, out2, { binDir: BIN });
  const frame2 = grabFrame(BIN, out2, SAMPLE_TIME);
  const ppm2 = path.join(BASELINE_DIR, 'mirror_zoom_reopen.ppm');
  fs.writeFileSync(ppm2, frameToPpm(frame2));

  const m1 = measure(frame1);
  const m2 = measure(frame2);
  const manifest = {
    capturedWith: 'engine/space.js baseline (pre-transform-refactor)',
    sampleTimeSec: SAMPLE_TIME,
    project: 'mirror then zoom 1.5x, follow+fixed lines, 1920x1080',
    direct: { file: path.basename(ppm1), ...m1 },
    reopen: { file: path.basename(ppm2), ...m2 },
    // Boundary the refactored kernel must stay inside (see equivalence.test.js).
    tolerance: { markerDeltaPx: 0.5, anchorChannelDelta: 1, differingPixelFraction: 0 },
  };
  fs.writeFileSync(
    path.join(BASELINE_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  console.log(JSON.stringify(manifest, null, 2));
}

// grabFrame already decodes a P6 PPM; re-emit a standalone PPM file from it so
// the baseline is viewable/decodable without the render pipeline.
function frameToPpm(frame) {
  const header = Buffer.from(`P6\n${frame.w} ${frame.h}\n255\n`, 'ascii');
  return Buffer.concat([header, frame.data]);
}

main().catch((e) => { console.error(e); process.exit(1); });
