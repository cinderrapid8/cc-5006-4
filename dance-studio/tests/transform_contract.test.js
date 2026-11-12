'use strict';

// Contract tests for the composable coordinate-transform kernel.
//
// The contract is deliberately strict: every entry point must reject missing
// or malformed arguments instead of silently treating them as zero/identity.
// These tests also pin the three-frame model (coded source pixels, project
// frames, device viewport) and prove the legacy DanceSpace adapter delegates
// to the same kernel functions.
const assert = require('assert');
const path = require('path');
const os = require('os');
const T = require('../engine/transform');
const legacySpace = require('../engine/space');
const { probeMedia } = require('../engine/media');

const BIN = path.join(os.homedir(), '.local', 'bin');
const FX = path.resolve(__dirname, 'fixtures');

let passed = 0;
const results = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(['PASS', name]);
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push(['FAIL', name, e]);
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

function assertThrows(fn, re) {
  assert.throws(fn, re);
}

function main() {
  const grid = probeMedia(path.join(BIN, 'ffprobe'), path.join(FX, 'grid_master.mp4'));
  const portrait = probeMedia(path.join(BIN, 'ffprobe'), path.join(FX, 'portrait_rot.mp4'));

  // ---- frame model constants ---------------------------------------------
  test('contract: exposes the three explicit frames', () => {
    assert.strictEqual(T.SOURCE_FRAME, 'coded');
    assert.deepStrictEqual(T.PROJECT_FRAMES, ['display', 'output']);
    assert.strictEqual(T.DEVICE_FRAME, 'device');
  });

  // ---- guards: no default-value masquerade --------------------------------
  test('contract: matrix primitives reject undefined/NaN input', () => {
    assertThrows(() => T.matrix.applyMatrix(undefined, 1, 2), /matrix/);
    assertThrows(() => T.matrix.applyMatrix([1, 0, 0, 1, 0, 0], undefined, 2), /x/);
    assertThrows(() => T.matrix.mul([1, 0, 0, 1, 0, 0], [1, 0, 0]), /matrix/);
    assertThrows(() => T.matrix.invert([0, 0, 0, 0, 0, 0]), /singular/);
  });

  test('contract: lineage rejects missing media dimensions and bad steps', () => {
    assertThrows(() => T.computeLineage({}, []), /displayWidth/);
    assertThrows(() => T.computeLineage(grid, null), /steps must be an array/);
    const bad = [
      { id: 'm', op: 'mirror', inSpace: 'display' },
      { id: 'c', op: 'crop', inSpace: 'display', rect: { x: 0, y: 0, w: 10, h: 10 } },
    ];
    assertThrows(() => T.computeLineage(grid, bad), /inSpace/);
    assertThrows(
      () => T.computeLineage(grid, [{ id: 'z', op: 'zoom', inSpace: 'display', factor: 0 }]),
      /zoom factor/
    );
    assertThrows(
      () => T.computeLineage(grid, [{ id: 'x', op: 'warp', inSpace: 'display' }]),
      /unknown transform op/
    );
  });

  test('contract: crop rect outside the tip is rejected, not clamped', () => {
    assertThrows(() => T.computeLineage(grid, [{
      id: 'c', op: 'crop', inSpace: 'display',
      rect: { x: 0, y: 0, w: grid.displayWidth + 1, h: 10 },
    }]), /exceeds space/);
    assertThrows(() => T.computeLineage(grid, [{
      id: 'c', op: 'crop', inSpace: 'display',
      rect: { x: -1, y: 0, w: 10, h: 10 },
    }]), /rect.x/);
  });

  test('contract: viewport rejects non-positive zoom and malformed rect', () => {
    assertThrows(() => T.deviceCanvasSize(1280, 720, 0), /zoom/);
    assertThrows(() => T.deviceCanvasSize(0, 720, 1), /outputWidth/);
    assertThrows(() => T.projectToDeviceMatrix(NaN), /zoom/);
    assertThrows(() => T.deviceToProject(1, 2, { left: 0 }, 1), /rect.top/);
  });

  test('contract: overlay requires numeric placement and point coords', () => {
    assertThrows(() => T.placementMatrix({ x: 0 }), /placement.y/);
    assertThrows(() => T.tipToOutput({ x: 0, y: 0 }, undefined, 1), /x/);
  });

  test('contract: sourceframe rejects unknown rotation', () => {
    assertThrows(() => T.transposeFor(45), /unsupported rotation/);
    assertThrows(() => T.codedToDisplayMatrix({ ...grid, rotation: 45 }), /unsupported rotation/);
  });

  // ---- source frame: coded -> display geometry ----------------------------
  test('sourceframe: rotation 90 matrix matches ffmpeg transpose anchors', () => {
    const M = T.codedToDisplayMatrix(portrait);
    const tl = T.matrix.applyMatrix(M, 0, portrait.height - 1);
    const br = T.matrix.applyMatrix(M, portrait.width - 1, 0);
    assert.deepStrictEqual(tl.map(Math.round), [0, 0]);
    assert.deepStrictEqual(br.map(Math.round), [1079, 1919]);
    const desc = T.sourceFrame(portrait);
    assert.strictEqual(desc.transpose, 'transpose=1');
    assert.strictEqual(desc.needsScale, false);
  });

  test('sourceframe: PAR media needs a scale and keeps square display height', () => {
    const ntsc = probeMedia(path.join(BIN, 'ffprobe'), path.join(FX, 'ntsc_par.mp4'));
    const desc = T.sourceFrame(ntsc);
    assert.strictEqual(desc.transpose, null);
    assert.strictEqual(desc.needsScale, true);
    assert.strictEqual(desc.scale.w, ntsc.displayWidth);
    assert.strictEqual(desc.scale.h, ntsc.displayHeight);
  });

  // ---- lineage: mirror/crop order stays distinct --------------------------
  test('lineage: mirror-then-crop and crop-then-mirror trace to different pixels', () => {
    const linA = T.computeLineage(grid, [
      { id: 'm', op: 'mirror', inSpace: 'display' },
      { id: 'c', op: 'crop', inSpace: 'm', rect: { x: 400, y: 0, w: 320, h: 720 } },
    ]);
    const linB = T.computeLineage(grid, [
      { id: 'c', op: 'crop', inSpace: 'display', rect: { x: 400, y: 0, w: 320, h: 720 } },
      { id: 'm', op: 'mirror', inSpace: 'c' },
    ]);
    assert.strictEqual(Math.round(T.mapSpaceToDisplay(linA, linA.tip, 0, 0)[0]), 879);
    assert.strictEqual(Math.round(T.mapSpaceToDisplay(linB, linB.tip, 0, 0)[0]), 719);
  });

  // ---- viewport: project -> device round trip -----------------------------
  test('viewport: device mapping is the zoom inverse for pointer hit-testing', () => {
    const size = T.deviceCanvasSize(1280, 720, 1.5);
    assert.deepStrictEqual(size, { width: 1920, height: 1080 });
    const [px, py] = T.deviceToProject(300, 150, { left: 0, top: 0 }, 1.5);
    assert.strictEqual(px, 200);
    assert.strictEqual(py, 100);
  });

  // ---- overlay: placement and follow-line output mapping ------------------
  test('overlay: tip->output translation and its inverse agree', () => {
    const placement = { x: 40, y: 60 };
    const [ox, oy] = T.tipToOutput(placement, 10, 20);
    assert.deepStrictEqual([ox, oy], [50, 80]);
    const back = T.outputToTip(placement, ox, oy);
    assert.deepStrictEqual(back, [10, 20]);
    const lin = T.computeLineage(grid, [{ id: 'm', op: 'mirror', inSpace: 'display' }]);
    const pts = T.followLineToOutput(lin, placement, [[0, 0]]);
    // mirror flips x only: display (0,0) -> tip (1279,0); then +placement
    assert.deepStrictEqual(pts[0].map(Math.round), [1319, 60]);
  });

  // ---- legacy adapter delegates to the kernel, not a parallel impl --------
  test('adapter: legacy DanceSpace functions are the kernel functions', () => {
    assert.strictEqual(legacySpace.computeLineage, T.computeLineage);
    assert.strictEqual(legacySpace.mapPolyline, T.mapPolyline);
    assert.strictEqual(legacySpace.mapSpaceToDisplay, T.mapSpaceToDisplay);
    assert.strictEqual(legacySpace.mapDisplayToSpace, T.mapDisplayToSpace);
    assert.strictEqual(legacySpace.mul, T.matrix.mul);
    assert.strictEqual(legacySpace.invert, T.matrix.invert);
    assert.strictEqual(legacySpace.applyMatrix, T.matrix.applyMatrix);
    assert.deepStrictEqual(legacySpace.IDENTITY, T.IDENTITY);
  });

  test('adapter: legacy entry produces identical lineage geometry', () => {
    const steps = [{ id: 'm', op: 'mirror', inSpace: 'display' }];
    const viaKernel = T.computeLineage(grid, steps);
    const viaLegacy = legacySpace.computeLineage(grid, steps);
    assert.deepStrictEqual(
      [...viaKernel.spaces.get('m').matrix],
      [...viaLegacy.spaces.get('m').matrix]
    );
    assert.strictEqual(viaKernel.tip, viaLegacy.tip);
  });

  console.log(`\n${passed}/${results.length} transform contract tests passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
