'use strict';

// Equivalence boundary for the coordinate-transform kernel refactor.
//
// The pre-refactor kernel (engine/space.js at the Task baseline commit)
// rendered the mirror-then-zoom project and its save/reload ("reopen") copy;
// tests/baseline/ freezes those frames plus the measured marker/anchor values.
// This test re-renders both through the refactored kernel and asserts the
// refactor stayed inside the documented boundary:
//   - full-frame pixel difference fraction == 0 (identical composition)
//   - moving marker centroid delta <= 0.5 px (marker alignment error)
//   - anchor patch channel delta <= 1   (picture alignment error)
//   - direct render sha256 == reopen sha256 (reopen must not move geometry)
// The expected numbers come from the checked-in manifest, not from defaults.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { render } = require('../engine/render');
const { saveProject, loadProject } = require('../engine/project');
const { grabFrame, findColor, patch, px } = require('./framegrab');
const { SAMPLE_TIME, mirrorZoomProject } = require('./equivalence_projects');

const BIN = path.join(os.homedir(), '.local', 'bin');
const BASELINE_DIR = path.resolve(__dirname, 'baseline');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'dance-eq-'));

const RED = [230, 60, 60];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readBaselinePpm(file) {
  const buf = fs.readFileSync(path.join(BASELINE_DIR, file));
  const marker = Buffer.from('\n255\n');
  const headerEnd = buf.indexOf(marker) + marker.length;
  const header = buf.slice(0, headerEnd).toString();
  const [, w, h] = /\n(\d+)\s+(\d+)\n/.exec(header);
  return { w: Number(w), h: Number(h), data: buf.slice(headerEnd) };
}

function differingPixelFraction(a, b) {
  assert.strictEqual(a.data.length, b.data.length, 'frame byte length changed');
  let diff = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) diff++;
  }
  return diff / a.data.length;
}

function measureMarker(frame) {
  // Same search window the baseline capture used (marker lands in the left
  // half after mirror + 1.5x zoom).
  return findColor(frame, RED, [960, 700, 1600, 960], 50);
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  PASS  ${name}`);
}

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(BASELINE_DIR, 'manifest.json'), 'utf8')
  );
  const tol = manifest.tolerance;
  const project = mirrorZoomProject();

  // ---- direct render through the refactored kernel ------------------------
  const out1 = path.join(WORK, 'direct.mp4');
  await render(project, out1, { binDir: BIN });
  const frame1 = grabFrame(BIN, out1, SAMPLE_TIME);

  const base1 = readBaselinePpm(manifest.direct.file);
  await test('mirror-then-zoom: full-frame pixel diff fraction is 0 vs baseline', () => {
    const frac = differingPixelFraction(base1, frame1);
    assert.strictEqual(frac, 0, `picture alignment error: ${frac} of pixels differ`);
  });

  await test('mirror-then-zoom: frame sha256 is byte-identical to the frozen baseline', () => {
    assert.strictEqual(sha256(frame1.data), manifest.direct.frame.sha256);
  });

  await test('mirror-then-zoom: moving marker centroid stays within 0.5px', () => {
    const now = measureMarker(frame1);
    const base = manifest.direct.marker;
    assert.ok(now, 'marker disappeared after refactor');
    const dx = now.x - base.x, dy = now.y - base.y;
    assert.ok(Math.abs(dx) <= tol.markerDeltaPx, `marker x error ${dx}`);
    assert.ok(Math.abs(dy) <= tol.markerDeltaPx, `marker y error ${dy}`);
    console.log(`        marker centroid ${base.x.toFixed(2)},${base.y.toFixed(2)} ` +
      `-> ${now.x.toFixed(2)},${now.y.toFixed(2)} (|dx|=${Math.abs(dx).toFixed(3)}, ` +
      `|dy|=${Math.abs(dy).toFixed(3)})`);
  });

  await test('mirror-then-zoom: anchor patches stay within 1 channel unit', () => {
    for (const key of ['anchorTopLeft', 'anchorBottomLeft']) {
      const base = manifest.direct[key];
      const now = key === 'anchorTopLeft'
        ? patch(frame1, 18, 18, 4) : patch(frame1, 18, 1062, 4);
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs(now[c] - base[c]) <= tol.anchorChannelDelta,
          `${key} channel ${c}: base ${base[c]} now ${now[c]}`);
      }
    }
  });

  // ---- reopen: save -> validate/load -> render ----------------------------
  const savedFile = saveProject(WORK, project);
  const reopened = loadProject(savedFile);
  const out2 = path.join(WORK, 'reopen.mp4');
  await render(reopened, out2, { binDir: BIN });
  const frame2 = grabFrame(BIN, out2, SAMPLE_TIME);

  const base2 = readBaselinePpm(manifest.reopen.file);
  await test('reopen: reloaded project renders frame-identical to baseline', () => {
    assert.strictEqual(differingPixelFraction(base2, frame2), 0);
    assert.strictEqual(sha256(frame2.data), manifest.reopen.frame.sha256);
  });

  await test('reopen: marker centroid matches the frozen reopen measurement', () => {
    const now = measureMarker(frame2);
    const base = manifest.reopen.marker;
    assert.ok(now, 'marker missing after reopen');
    assert.ok(Math.abs(now.x - base.x) <= tol.markerDeltaPx);
    assert.ok(Math.abs(now.y - base.y) <= tol.markerDeltaPx);
  });

  await test('reopen: direct and reopen renders share one sha256 (geometry stable)', () => {
    assert.strictEqual(sha256(frame1.data), sha256(frame2.data));
    assert.strictEqual(sha256(frame1.data), manifest.direct.frame.sha256);
  });

  // Sanity: framegrab px helper still indexes the same output dimensions.
  assert.strictEqual(frame1.w, manifest.direct.frame.w);
  assert.strictEqual(frame1.h, manifest.direct.frame.h);
  void px;

  console.log(`\n${passed}/7 equivalence checks passed (boundary: ` +
    `marker<=${tol.markerDeltaPx}px, anchor<=${tol.anchorChannelDelta}, ` +
    `pixelDiff=${tol.differingPixelFraction})`);
}

main().catch((e) => { console.error('EQUIVALENCE FAIL:', e); process.exit(1); });
