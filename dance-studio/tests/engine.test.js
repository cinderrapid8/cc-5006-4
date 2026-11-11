'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { probeMedia } = require('../engine/media');
const space = require('../engine/space');
const { createProject, validateProject, saveProject, loadProject } = require('../engine/project');
const { render } = require('../engine/render');
const { grabFrame, px, patch, isNear, findColor } = require('./framegrab');

const BIN = path.join(os.homedir(), '.local', 'bin');
const FX = path.join(__dirname, 'fixtures');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'dance-test-'));

let passed = 0;
const results = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push(['PASS', name]);
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push(['FAIL', name, e]);
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

function mediaFor(file) {
  return probeMedia(path.join(BIN, 'ffprobe'), path.resolve(FX, file));
}

function addLayer(project, name, media, extra = {}) {
  const id = `layer_${project.layers.length}`;
  const layer = {
    id, name, mediaId: `m${Object.keys(project.media).length}`,
    steps: [],
    placement: { x: 0, y: 0 },
    opacity: 1,
    interval: { start: 0, end: media.duration || 2 },
    endPolicy: 'hide',
    ...extra,
  };
  project.media[layer.mediaId] = media;
  project.layers.push(layer);
  return layer;
}

async function renderTo(project, label) {
  const out = path.join(WORK, `${label}.mp4`);
  await render(project, out, { binDir: BIN });
  return out;
}

// Fixture anchor colours
const GREEN = [0, 255, 0], MAGENTA = [255, 0, 255], RED = [230, 60, 60];
const LBLUE = [0, 200, 255], ORANGE = [255, 120, 0];

async function main() {
  console.log('work dir:', WORK);

  // ---- 1. space math: mirror vs crop order are distinct lineages ----------
  await test('space math rejects steps whose inSpace is not the current tip', () => {
    const media = mediaFor('grid_master.mp4');
    const bad = createProject();
    const l = addLayer(bad, 'x', media);
    l.steps = [
      { id: 'm1', op: 'mirror', inSpace: 'display' },
      { id: 'c1', op: 'crop', inSpace: 'display', rect: { x: 0, y: 0, w: 100, h: 100 } },
    ];
    assert.throws(() => validateProject(bad), /inSpace/);
    assert.throws(() => space.computeLineage(media, l.steps), /inSpace/);
  });

  await test('mirror-then-crop and crop-then-mirror keep coordinates in their own spaces', () => {
    const media = mediaFor('grid_master.mp4'); // 1280x720 display
    // Asymmetric 320-wide window: mirror-first takes the mirrored tip's
    // [400,720) strip; crop-first takes display's [400,720) then flips it.
    const mirrorFirst = [
      { id: 'm', op: 'mirror', inSpace: 'display' },
      { id: 'c', op: 'crop', inSpace: 'm', rect: { x: 400, y: 0, w: 320, h: 720 } },
    ];
    const cropFirst = [
      { id: 'c', op: 'crop', inSpace: 'display', rect: { x: 400, y: 0, w: 320, h: 720 } },
      { id: 'm', op: 'mirror', inSpace: 'c' },
    ];
    const linA = space.computeLineage(media, mirrorFirst);
    const linB = space.computeLineage(media, cropFirst);
    assert.strictEqual(linA.spaces.get(linA.tip).w, 320);
    // mirror-first output pixel 0 traces back to display x = 1279-400 = 879
    assert.strictEqual(Math.round(space.mapSpaceToDisplay(linA, linA.tip, 0, 0)[0]), 879);
    // crop-first output pixel 0 (the flip's left edge) traces to display x = 719
    assert.strictEqual(Math.round(space.mapSpaceToDisplay(linB, linB.tip, 0, 0)[0]), 719);
    // The two orders therefore show different source columns — they cannot be
    // interchanged, and each crop rect is valid only in its declared space.
    assert.notStrictEqual(
      Math.round(space.mapSpaceToDisplay(linA, linA.tip, 0, 0)[0]),
      Math.round(space.mapSpaceToDisplay(linB, linB.tip, 0, 0)[0]),
    );
    // Symmetric (commuting) case: mirrored 960-start window == crop of 0..320.
    const sym = space.computeLineage(media, [
      { id: 'm', op: 'mirror', inSpace: 'display' },
      { id: 'c', op: 'crop', inSpace: 'm', rect: { x: 960, y: 0, w: 320, h: 720 } },
    ]);
    assert.strictEqual(Math.round(space.mapSpaceToDisplay(sym, sym.tip, 0, 0)[0]), 319);
  });

  // ---- 2. real render: mirrored layer swaps L/R letters -------------------
  await test('render: mirror swaps L and R sides of the master clip', async () => {
    const p = createProject('mirror');
    p.output = { width: 1280, height: 720, fps: 30, bgColor: '#101418' };
    const media = mediaFor('grid_master.mp4');
    const l = addLayer(p, 'master', media, {
      steps: [{ id: 'm', op: 'mirror', inSpace: 'display' }],
      interval: { start: 0, end: 2 },
    });
    const out = await renderTo(p, 'mirror');
    const f = grabFrame(BIN, out, 0.5);
    // L label (blue) starts on the left; after mirror it must appear on the right.
    const rightBlue = findColor(f, LBLUE, [900, 250, 1280, 400], 60);
    const leftBlue = findColor(f, LBLUE, [0, 250, 380, 400], 60);
    assert.ok(rightBlue && rightBlue.count > 50, 'blue L should move to the right');
    assert.ok(!leftBlue || leftBlue.count < 20, 'blue L should not remain left');
    // green top-left anchor moves to top-right
    assert.ok(isNear(patch(f, 12, 12), [16, 20, 24], 30), 'original TL must be background now');
    assert.ok(isNear(patch(f, 1280 - 12, 12), GREEN, 45), 'green anchor mirrored to TR');
  });

  // ---- 3. transform order verified on actual pixels -----------------------
  await test('render: asymmetric windows make mirror/crop order visually distinct', async () => {
    const media = mediaFor('grid_master.mp4');
    // Window x in [400,720). Order A mirrors first: the mirrored strip shows
    // display columns (1279-400)..(1279-720) = 879..559. Order B crops first
    // then mirrors: it shows display columns 719..400. Different source range.
    const mk = (steps) => {
      const p = createProject('o');
      p.output = { width: 320, height: 720, fps: 30, bgColor: '#000000' };
      p.media.m0 = media;
      p.layers.push({
        id: 'l', name: 'o', mediaId: 'm0', steps,
        placement: { x: 0, y: 0 }, opacity: 1,
        interval: { start: 0, end: 2 }, endPolicy: 'hide',
      });
      return p;
    };
    const outA = await renderTo(mk([
      { id: 'm', op: 'mirror', inSpace: 'display' },
      { id: 'c', op: 'crop', inSpace: 'm', rect: { x: 400, y: 0, w: 320, h: 720 } },
    ]), 'orderA');
    const outB = await renderTo(mk([
      { id: 'c', op: 'crop', inSpace: 'display', rect: { x: 400, y: 0, w: 320, h: 720 } },
      { id: 'm', op: 'mirror', inSpace: 'c' },
    ]), 'orderB');
    const fA = grabFrame(BIN, outA, 0.5);
    const fB = grabFrame(BIN, outB, 0.5);
    // The moving red step marker occupies different source columns under the
    // two orders: measure its presence/position across the whole output.
    const redA = findColor(fA, RED, [0, 0, 320, 720], 50);
    const redB = findColor(fB, RED, [0, 0, 320, 720], 50);
    assert.ok(redB, 'crop-first render must contain the moving step marker');
    // Order A sources columns 559..879; at t=0.5 the marker (display x≈350)
    // is outside that range, so A must NOT show it while B (cols 400..719) does.
    assert.ok(!redA, 'mirror-first window must exclude the marker at this frame');
    // And the geometry engine must agree with where each output pixel came from.
    const linA = space.computeLineage(media, [
      { id: 'm', op: 'mirror', inSpace: 'display' },
      { id: 'c', op: 'crop', inSpace: 'm', rect: { x: 400, y: 0, w: 320, h: 720 } },
    ]);
    assert.strictEqual(Math.round(space.mapSpaceToDisplay(linA, linA.tip, 0, 0)[0]), 879);
    const linB = space.computeLineage(media, [
      { id: 'c', op: 'crop', inSpace: 'display', rect: { x: 400, y: 0, w: 320, h: 720 } },
      { id: 'm', op: 'mirror', inSpace: 'c' },
    ]);
    assert.strictEqual(Math.round(space.mapSpaceToDisplay(linB, linB.tip, 0, 0)[0]), 719);
  });

  // ---- 4. layer occlusion: later layer covers earlier ---------------------
  await test('render: top layer occludes the bottom layer at the overlap', async () => {
    const p = createProject('occ');
    p.output = { width: 640, height: 480, fps: 30, bgColor: '#101418' };
    const base = mediaFor('grid_master.mp4');
    const foot = mediaFor('foot_alpha.mov');
    addLayer(p, 'base', base, { placement: { x: 0, y: 0 }, interval: { start: 0, end: 2 } });
    addLayer(p, 'foot', foot, { placement: { x: 100, y: 80 }, interval: { start: 0, end: 2 } });
    const out = await renderTo(p, 'occlusion');
    const f = grabFrame(BIN, out, 0.5);
    // the alpha foot (greenish [80,220,160]) must be visible over the base clip
    const hit = findColor(f, [80, 220, 160], [150, 100, 550, 420], 45);
    assert.ok(hit && hit.count > 100, 'top alpha layer must be visible over the base');
  });

  // ---- 5. portrait rotation metadata is honoured --------------------------
  await test('render: 90-degree rotation metadata yields upright portrait frame', async () => {
    const p = createProject('rot');
    const media = mediaFor('portrait_rot.mp4');
    assert.strictEqual(media.rotation, 90);
    assert.deepStrictEqual([media.displayWidth, media.displayHeight], [1080, 1920]);
    p.output = { width: 1080, height: 1920, fps: 30, bgColor: '#000000' };
    addLayer(p, 'phone', media, { interval: { start: 0, end: 1.5 } });
    const out = await renderTo(p, 'portrait');
    const f = grabFrame(BIN, out, 0.3);
    assert.strictEqual(f.w, 1080); assert.strictEqual(f.h, 1920);
    // green anchor: coded bottom-left -> upright display TOP-left
    assert.ok(isNear(patch(f, 40, 40), GREEN, 45), 'green must be at upright top-left');
    // magenta: coded top-right -> upright BOTTOM-right
    assert.ok(isNear(patch(f, 1040, 1880), MAGENTA, 45), 'magenta must be at upright bottom-right');
    // L letter on the display left half (it lands near the top after rotation)
    const lMark = findColor(f, LBLUE, [0, 0, 540, 400], 60);
    const rMark = findColor(f, ORANGE, [540, 1500, 1080, 1920], 60);
    assert.ok(lMark && lMark.x < 540, 'L letter should read on the left side');
    assert.ok(rMark && rMark.x >= 540, 'R letter should read on the right side');
  });

  // ---- 6. non-square pixels: grid cells become square on output -----------
  await test('render: non-square PAR is corrected so grid cells are square', async () => {
    const p = createProject('par');
    const media = mediaFor('ntsc_par.mp4');
    p.output = { width: media.displayWidth, height: media.displayHeight, fps: 30, bgColor: '#000000' };
    addLayer(p, 'ntsc', media, { interval: { start: 0, end: 1.5 } });
    const out = await renderTo(p, 'par');
    const f = grabFrame(BIN, out, 0.3);
    // Score every column by how many bluish grid pixels it holds across the
    // full height (robust to the moving red marker covering one scanline).
    const colScore = new Array(f.w).fill(0);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const c = px(f, x, y);
        if (c[2] > c[0] + 15 && c[2] > 80) colScore[x]++;
      }
    }
    const maxScore = Math.max(...colScore);
    const gridCols = [];
    for (let x = 0; x < f.w; x++) {
      if (colScore[x] > maxScore * 0.5 &&
          (!gridCols.length || x - gridCols[gridCols.length - 1] > 20)) {
        gridCols.push(x);
      }
    }
    const pitchesX = gridCols.slice(1).map((v, i) => v - gridCols[i]);
    const avgPitch = pitchesX.reduce((a, b) => a + b, 0) / pitchesX.length;
    assert.ok(gridCols.length >= 4, `expected several grid columns, got ${gridCols.length}`);
    assert.ok(Math.abs(avgPitch - 90 * (10 / 11)) < 4,
      `x pitch ${avgPitch.toFixed(1)} should match PAR-corrected ${(90 * 10 / 11).toFixed(1)}`);
    // vertical pitch stays 80 (PAR only affects horizontal)
    const rowScore = new Array(f.h).fill(0);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const c = px(f, x, y);
        if (c[2] > c[0] + 15 && c[2] > 80) rowScore[y]++;
      }
    }
    const maxRow = Math.max(...rowScore);
    const gridRows = [];
    for (let y = 0; y < f.h; y++) {
      if (rowScore[y] > maxRow * 0.5 &&
          (!gridRows.length || y - gridRows[gridRows.length - 1] > 20)) {
        gridRows.push(y);
      }
    }
    const pitchesY = gridRows.slice(1).map((v, i) => v - gridRows[i]);
    const avgY = pitchesY.reduce((a, b) => a + b, 0) / pitchesY.length;
    assert.ok(Math.abs(avgY - 80) < 3, `y pitch ${avgY} should stay 80`);
    assert.ok(Math.abs(avgPitch - avgY) < 4, 'corrected cells must be nearly square');
  });

  // ---- 7. alpha: no dark fringe at the soft edge --------------------------
  await test('render: soft alpha edge blends without a dark fringe', async () => {
    const p = createProject('alpha');
    p.output = { width: 640, height: 480, fps: 30, bgColor: '#ffffff' };
    const media = mediaFor('foot_alpha.mov');
    addLayer(p, 'foot', media, { interval: { start: 0, end: 1.5 } });
    const out = await renderTo(p, 'alpha');
    const f = grabFrame(BIN, out, 0.5);
    // Outside the disc: pure white background (proves transparent pixels stay clear).
    assert.ok(isNear(patch(f, 20, 20), [255, 255, 255], 6), 'transparent area must show bg');
    // Scan a horizontal line through the disc centre; find the feathered edge.
    const cy = 260;
    let edgeX = -1;
    for (let x = 10; x < 320; x++) {
      const c = px(f, x, cy);
      if (c[1] > c[0] + 40 && c[1] > c[2]) { edgeX = x; break; }
    }
    assert.ok(edgeX > 0, 'disc edge not found');
    // The feathered ring pixels are green mixed with white: they must be LIGHT
    // (green+white), never dark. A dark-fringe bug drives them toward black.
    const feather = px(f, edgeX - 1, cy);
    assert.ok(feather[0] + feather[1] + feather[2] > 380,
      `feather pixel ${JSON.stringify(feather)} is too dark — premultiply/dark-fringe bug`);
    assert.ok(feather[1] >= feather[2], 'feather should carry the source green tint');
  });

  // ---- 8. opacity scales alpha, not a black overlay -----------------------
  await test('render: 50% opacity blends source colour with background', async () => {
    const p = createProject('op');
    p.output = { width: 640, height: 480, fps: 30, bgColor: '#ffffff' };
    const media = mediaFor('foot_alpha.mov');
    addLayer(p, 'foot', media, { opacity: 0.5, interval: { start: 0, end: 1.5 } });
    const out = await renderTo(p, 'opacity');
    const f = grabFrame(BIN, out, 0.5);
    // Opaque core source is (80,220,160); at 50% over white expect ~(167,237,207)
    const c = patch(f, 320, 260, 6);
    assert.ok(c[0] > 130 && c[0] < 200, `red channel ${c[0]} inconsistent with 50% blend`);
    assert.ok(c[1] > 215, `green channel ${c[1]} inconsistent with 50% blend`);
    assert.ok(c[2] > 175 && c[2] < 235, `blue channel ${c[2]} inconsistent with 50% blend`);
  });

  // ---- 9. timeline: hide vs freeze when the source ends -------------------
  await test('timeline: hide policy removes the layer after its interval ends', async () => {
    const p = createProject('hide');
    p.output = { width: 640, height: 480, fps: 30, bgColor: '#202020', duration: 3 };
    const media = mediaFor('foot_alpha.mov'); // 1.5s source
    addLayer(p, 'foot', media, {
      endPolicy: 'hide',
      interval: { start: 0, end: 1.2 }, // ends before the source runs out
    });
    const out = await renderTo(p, 'hide');
    const before = grabFrame(BIN, out, 1.0);
    const after = grabFrame(BIN, out, 2.0);
    assert.ok(findColor(before, [80, 220, 160], [100, 100, 540, 400], 45), 'visible inside interval');
    assert.ok(!findColor(after, [80, 220, 160], [100, 100, 540, 400], 45), 'hidden after interval end');
  });

  await test('timeline: hide policy loops the source for intervals longer than the clip', async () => {
    const p = createProject('hidelloop');
    p.output = { width: 640, height: 480, fps: 30, bgColor: '#202020' };
    const media = mediaFor('foot_alpha.mov'); // 1.5s source
    addLayer(p, 'foot', media, {
      endPolicy: 'hide',
      interval: { start: 0, end: 3 },
    });
    const out = await renderTo(p, 'hidelloop');
    // Source ended at 1.5s; the looped feed must still be visible at 2.5s.
    const late = grabFrame(BIN, out, 2.5);
    assert.ok(findColor(late, [80, 220, 160], [100, 100, 540, 400], 45),
      'looped source still visible inside a longer interval');
  });

  await test('timeline: freeze policy holds the final frame past source duration', async () => {
    const p = createProject('freeze');
    p.output = { width: 640, height: 480, fps: 30, bgColor: '#202020' };
    const media = mediaFor('foot_alpha.mov'); // 1.5s, disc centre drifts with sin(t/6)
    addLayer(p, 'foot', media, {
      endPolicy: 'freeze',
      interval: { start: 0, end: 3 },
    });
    const out = await renderTo(p, 'freeze');
    const last = grabFrame(BIN, out, 1.45);
    const held = grabFrame(BIN, out, 2.5);
    const a = findColor(last, [80, 220, 160], [100, 100, 540, 400], 45);
    const b = findColor(held, [80, 220, 160], [100, 100, 540, 400], 45);
    assert.ok(a && b, 'frozen frame must still show the disc');
    assert.ok(Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3,
      `frozen disc moved: ${a.x.toFixed(1)} vs ${b.x.toFixed(1)}`);
  });

  await test('timeline: interval start gates visibility', async () => {
    const p = createProject('gate');
    p.output = { width: 640, height: 480, fps: 30, bgColor: '#202020' };
    const media = mediaFor('foot_alpha.mov');
    addLayer(p, 'foot', media, { interval: { start: 1, end: 2.5 } });
    const out = await renderTo(p, 'gate');
    const early = grabFrame(BIN, out, 0.4);
    const mid = grabFrame(BIN, out, 1.5);
    assert.ok(!findColor(early, [80, 220, 160], [100, 100, 540, 400], 45), 'absent before start');
    assert.ok(findColor(mid, [80, 220, 160], [100, 100, 540, 400], 45), 'present inside interval');
  });

  // ---- 10. reference lines: follow vs fixed behave differently under mirror
  await test('lines: follow-line flips with the layer; fixed-line stays on canvas', async () => {
    const media = mediaFor('grid_master.mp4');
    const p = createProject('lines');
    p.output = { width: 1280, height: 720, fps: 30, bgColor: '#101418' };
    const l = addLayer(p, 'master', media, {
      steps: [{ id: 'm', op: 'mirror', inSpace: 'display' }],
      interval: { start: 0, end: 2 },
    });
    // follow line at display x=200 (a vertical segment); must travel to x=1079 after flip
    p.lines.push({
      id: 'lineFollow', mode: 'follow', layerId: l.id, inSpace: 'display',
      points: [[200, 100], [200, 600]], color: '#ffff00', thickness: 6,
    });
    // fixed canvas line at output x=900; must remain at x=900 regardless
    p.lines.push({
      id: 'lineFixed', mode: 'fixed', inSpace: 'output',
      points: [[900, 100], [900, 600]], color: '#00ffff', thickness: 6,
    });
    const out = await renderTo(p, 'lines');
    const f = grabFrame(BIN, out, 0.5);
    // yellow follow line should now be around x=1079
    const yellow = findColor(f, [255, 255, 0], [1000, 100, 1180, 620], 50);
    assert.ok(yellow, 'follow line missing');
    assert.ok(Math.abs(yellow.x - 1079) < 12, `follow line at ${yellow.x}, expected ~1079`);
    // cyan fixed line stays at 900
    const cyan = findColor(f, [0, 255, 255], [840, 100, 960, 620], 50);
    assert.ok(cyan, 'fixed line missing');
    assert.ok(Math.abs(cyan.x - 900) < 10, `fixed line at ${cyan.x}, expected 900`);
  });

  // ---- 11. save/load round trip preserves every space and policy ----------
  await test('project: save/load round-trip preserves steps, spaces and policies', async () => {
    const p = createProject('roundtrip');
    p.output = { width: 1080, height: 1920, fps: 30, bgColor: '#000000' };
    const media = mediaFor('portrait_rot.mp4');
    const l = addLayer(p, 'phone', media, {
      steps: [
        { id: 'm', op: 'mirror', inSpace: 'display' },
        { id: 'c', op: 'crop', inSpace: 'm', rect: { x: 100, y: 200, w: 500, h: 900 } },
        { id: 'z', op: 'zoom', inSpace: 'c', factor: 1.5 },
      ],
      opacity: 0.7, endPolicy: 'freeze',
      interval: { start: 0.5, end: 4 },
      placement: { x: 30, y: 40 },
    });
    p.lines.push({ id: 'g', mode: 'follow', layerId: l.id, inSpace: 'display',
      points: [[10, 10], [400, 400]], color: '#ff00ff', thickness: 4 });
    p.ui.previewZoom = 1.75;
    const file = saveProject(WORK, p);
    const q = loadProject(file);
    assert.strictEqual(q.ui.previewZoom, 1.75);
    assert.deepStrictEqual(q.layers[0].steps, l.steps);
    assert.strictEqual(q.layers[0].endPolicy, 'freeze');
    assert.strictEqual(q.media[q.layers[0].mediaId].rotation, 90);
    // loaded project still renders
    const out = path.join(WORK, 'roundtrip_render.mp4');
    await render(q, out, { binDir: BIN });
    assert.ok(fs.existsSync(out));
  });

  // ---- 12. preview zoom is display-only: same project, unchanged export ---
  await test('previewZoom does not alter the exported composition', async () => {
    const base = createProject('z1');
    base.output = { width: 640, height: 480, fps: 30, bgColor: '#202020' };
    const media = mediaFor('foot_alpha.mov');
    addLayer(base, 'foot', media, { interval: { start: 0, end: 1.5 } });
    const out1 = await renderTo(base, 'zoom1');
    const zoomed = JSON.parse(JSON.stringify(base));
    zoomed.ui.previewZoom = 2.5;
    const out2 = await renderTo(zoomed, 'zoom2');
    const a = grabFrame(BIN, out1, 0.7);
    const b = grabFrame(BIN, out2, 0.7);
    assert.strictEqual(a.w, b.w); assert.strictEqual(a.h, b.h);
    let diff = 0;
    for (let i = 0; i < a.data.length; i += 97) diff += Math.abs(a.data[i] - b.data[i]);
    assert.ok(diff === 0, `pixel data differs despite preview-only zoom (diff=${diff})`);
  });

  // ---- 13. zoom step scales around the centre and keeps placement ---------
  await test('zoom: 2x step doubles tip dimensions around the centre', () => {
    const media = mediaFor('ntsc_par.mp4');
    const lin = space.computeLineage(media, [
      { id: 'z', op: 'zoom', inSpace: 'display', factor: 2 },
    ]);
    const rec = lin.spaces.get('z');
    assert.strictEqual(rec.w, media.displayWidth * 2);
    assert.strictEqual(rec.h, media.displayHeight * 2);
    const centre = space.mapDisplayToSpace(lin, 'z',
      (media.displayWidth - 1) / 2, (media.displayHeight - 1) / 2);
    assert.ok(Math.abs(centre[0] - (rec.w - 1) / 2) < 1.5);
    assert.ok(Math.abs(centre[1] - (rec.h - 1) / 2) < 1.5);
  });

  console.log(`\n${passed}/${results.length} tests passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
