'use strict';

// Browser editor state. Mirrors the engine project schema exactly, so what is
// rendered on the canvas is what the backend ffmpeg pipeline will export.
const state = {
  project: {
    schemaVersion: 1,
    name: 'Untitled dance lesson',
    output: { width: 1280, height: 720, fps: 30, bgColor: '#101418', duration: 3 },
    media: {},
    layers: [],
    lines: [],
    ui: { previewZoom: 1 },
  },
  mediaIndex: [],
  selectedMediaId: null,
  selectedLayerId: null,
  selectedLineId: null,
  videoEls: {},          // mediaId -> HTMLVideoElement (preview source)
  drawMode: null,        // null | 'follow' | 'fixed'
  timelineDrag: null,
};

const $ = (id) => document.getElementById(id);
// All coordinate geometry goes through the composable transform kernel.
//   lineage     : mirror/crop/zoom steps within project frames
//   sourceframe : coded source pixels -> upright display frame
//   viewport    : project output -> on-screen device window (preview zoom)
//   overlay     : layer tip -> output canvas placement
const T = window.DanceTransform;

async function api(path, options) {
  const r = await fetch(path, options);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

function selectedLayer() {
  return state.project.layers.find((l) => l.id === state.selectedLayerId) || null;
}

function tipSpace(layer) {
  const lin = T.computeLineage(state.project.media[layer.mediaId], layer.steps);
  return { lin, tipRec: lin.spaces.get(lin.tip) };
}

// ---------------------------------------------------------------- media ---
async function uploadMedia(file) {
  const fd = new FormData();
  fd.append('file', file);
  const { mediaId, media } = await api('/api/media', { method: 'POST', body: fd });
  state.project.media[mediaId] = media;
  state.mediaIndex.push({ mediaId, media });
  state.selectedMediaId = mediaId;
  renderMediaList();
}

function loadVideoElement(mediaId) {
  if (state.videoEls[mediaId]) return state.videoEls[mediaId];
  const v = document.createElement('video');
  v.src = `/media/${mediaId}`;
  v.muted = true; v.loop = true; v.playsInline = true;
  v.play().catch(() => {});
  state.videoEls[mediaId] = v;
  return v;
}

function renderMediaList() {
  const ul = $('mediaList');
  ul.innerHTML = '';
  for (const { mediaId, media } of state.mediaIndex) {
    const li = document.createElement('li');
    if (mediaId === state.selectedMediaId) li.className = 'selected';
    const badges = [];
    if (media.rotation) badges.push(`<span class="badge rot">旋转 ${media.rotation}°</span>`);
    if (media.parNum !== media.parDen) badges.push(`<span class="badge par">PAR ${media.sar}</span>`);
    if (media.hasAlpha) badges.push(`<span class="badge">透明</span>`);
    li.innerHTML = `<strong>${mediaId.split('_').slice(1).join('_')}</strong>
      <div class="meta">coded ${media.width}×${media.height} → display ${media.displayWidth}×${media.displayHeight}
      ${badges.join(' ')}</div>`;
    li.onclick = () => { state.selectedMediaId = mediaId; renderMediaList(); };
    ul.appendChild(li);
  }
}

// --------------------------------------------------------------- layers ---
function addLayer() {
  if (!state.selectedMediaId) { alert('请先选择一个素材'); return; }
  const media = state.project.media[state.selectedMediaId];
  const id = `layer_${Date.now()}`;
  const layer = {
    id,
    name: `图层 ${state.project.layers.length + 1}`,
    mediaId: state.selectedMediaId,
    steps: [],
    placement: { x: 40, y: 40 },
    opacity: 1,
    interval: { start: 0, end: state.project.output.duration },
    endPolicy: 'hide',
  };
  state.project.layers.push(layer);
  state.selectedLayerId = id;
  loadVideoElement(state.selectedMediaId);
  renderLayerList();
  renderInspector();
  drawTimeline();
}

function renderLayerList() {
  const ul = $('layerList');
  ul.innerHTML = '';
  state.project.layers.forEach((layer, i) => {
    const li = document.createElement('li');
    if (layer.id === state.selectedLayerId) li.className = 'selected';
    li.innerHTML = `<strong>${i + 1}. ${layer.name}</strong>
      <div class="meta">步骤 ${layer.steps.length} · 透明度 ${Math.round(layer.opacity * 100)}% ·
      ${layer.interval.start.toFixed(1)}–${layer.interval.end.toFixed(1)}s ·
      ${layer.endPolicy === 'freeze' ? '静帧' : '隐藏'}</div>`;
    li.onclick = () => { state.selectedLayerId = layer.id; renderLayerList(); renderInspector(); };
    ul.appendChild(li);
  });
}

// ------------------------------------------------------------ inspector ---
function renderInspector() {
  const layer = selectedLayer();
  const host = $('inspector');
  if (!layer) {
    host.innerHTML = '<h2>图层检查器</h2><p class="muted">选择一个图层以编辑变换、透明度、位置与时间区间。</p>';
    return;
  }
  const media = state.project.media[layer.mediaId];
  const { lin, tipRec } = tipSpace(layer);
  const stepRows = layer.steps.map((s, i) => {
    const detail = s.op === 'crop'
      ? `x${s.rect.x} y${s.rect.y} ${s.rect.w}×${s.rect.h}`
      : s.op === 'zoom' ? `${s.factor}×` : '水平翻转';
    const opName = { mirror: '镜像', crop: '裁切', zoom: '缩放' }[s.op];
    return `<li><span class="space-tag">in:${s.inSpace}</span> ${opName}
      <span class="meta">${detail}</span>
      <button data-del-step="${i}" class="danger">删</button></li>`;
  }).join('');

  host.innerHTML = `
    <h2>图层检查器</h2>
    <div class="field-grid">
      <label>名称 <input type="text" id="fName" value="${layer.name}"></label>
      <label>不透明度 <input type="number" id="fOpacity" min="0" max="1" step="0.05" value="${layer.opacity}"></label>
      <label>画布 X <input type="number" id="fX" value="${layer.placement.x}"></label>
      <label>画布 Y <input type="number" id="fY" value="${layer.placement.y}"></label>
      <label>区间起 <input type="number" id="fStart" step="0.1" value="${layer.interval.start}"></label>
      <label>区间止 <input type="number" id="fEnd" step="0.1" value="${layer.interval.end}"></label>
    </div>
    <label>源结束策略
      <select id="fPolicy">
        <option value="hide" ${layer.endPolicy === 'hide' ? 'selected' : ''}>隐藏 (hide)</option>
        <option value="freeze" ${layer.endPolicy === 'freeze' ? 'selected' : ''}>静帧 (freeze)</option>
      </select>
    </label>

    <h2 style="margin-top:14px">变换步骤（顺序即滤镜顺序）</h2>
    <ul class="steps-list">${stepRows || '<li class="muted">尚无步骤，当前空间为 display</li>'}</ul>
    <div class="row">
      <button id="addMirror">+ 镜像（in: ${lin.tip}）</button>
      <button id="addCrop">+ 裁切（in: ${lin.tip}）</button>
      <button id="addZoom">+ 缩放（in: ${lin.tip}）</button>
    </div>
    <p class="hint">当前末端空间 <code>${lin.tip}</code>，尺寸 ${tipRec.w}×${tipRec.h}（方像素）。
      源 coded ${media.width}×${media.height}${media.rotation ? `，旋转元数据 ${media.rotation}°` : ''}
      ${media.parNum !== media.parDen ? `，PAR ${media.sar}` : ''}。</p>
    <div class="row"><button id="delLayer" class="danger">删除图层</button></div>`;

  $('fName').onchange = (e) => { layer.name = e.target.value; renderLayerList(); };
  $('fOpacity').onchange = (e) => { layer.opacity = clamp(Number(e.target.value), 0, 1); renderLayerList(); draw(); };
  $('fX').onchange = (e) => { layer.placement.x = Number(e.target.value); draw(); };
  $('fY').onchange = (e) => { layer.placement.y = Number(e.target.value); draw(); };
  $('fStart').onchange = (e) => { layer.interval.start = Number(e.target.value); renderLayerList(); drawTimeline(); };
  $('fEnd').onchange = (e) => { layer.interval.end = Number(e.target.value); renderLayerList(); drawTimeline(); };
  $('fPolicy').onchange = (e) => { layer.endPolicy = e.target.value; renderLayerList(); };

  $('addMirror').onclick = () => addStep(layer, { id: `s${Date.now()}`, op: 'mirror', inSpace: lin.tip });
  $('addCrop').onclick = () => {
    const parent = lin.spaces.get(lin.tip);
    const rect = defaultCropRect(parent.w, parent.h);
    addStep(layer, { id: `s${Date.now()}`, op: 'crop', inSpace: lin.tip, rect });
  };
  $('addZoom').onclick = () => addStep(layer, { id: `s${Date.now()}`, op: 'zoom', inSpace: lin.tip, factor: 1.5 });
  host.querySelectorAll('[data-del-step]').forEach((b) => {
    b.onclick = () => { layer.steps.splice(Number(b.dataset.delStep), 1); renderInspector(); draw(); };
  });
  $('delLayer').onclick = () => {
    state.project.layers = state.project.layers.filter((l) => l.id !== layer.id);
    state.selectedLayerId = null;
    renderLayerList(); renderInspector(); drawTimeline(); draw();
  };
}

function addStep(layer, step) {
  layer.steps.push(step);
  renderInspector();
  draw();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// UI-only seed for a new crop: a quarter-area window at the tip origin.
function defaultCropRect(w, h) {
  return { x: 0, y: 0, w: Math.round(w / 2), h: Math.round(h / 2) };
}

// ------------------------------------------------------------- preview ----
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

function draw() {
  const { width: W, height: H } = state.project.output;
  const zoom = state.project.ui.previewZoom;
  // Project output frame -> device viewport: viewport module owns the scale.
  const device = T.deviceCanvasSize(W, H, zoom);
  canvas.width = device.width;
  canvas.height = device.height;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const V = T.projectToDeviceMatrix(zoom);
  ctx.setTransform(V[0], V[1], V[2], V[3], V[4], V[5]);

  ctx.fillStyle = state.project.output.bgColor;
  ctx.fillRect(0, 0, W, H);

  if ($('showGrid').checked) drawCanvasGrid(W, H);

  // Layers bottom-to-top.
  for (const layer of state.project.layers) {
    const media = state.project.media[layer.mediaId];
    const video = state.videoEls[layer.mediaId];
    if (!video || video.readyState < 2) continue;
    const { lin, tipRec } = tipSpace(layer);
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    const P = T.placementMatrix(layer.placement);
    ctx.transform(P[0], P[1], P[2], P[3], P[4], P[5]);
    drawLayerContent(ctx, video, media, layer, lin, tipRec);
    ctx.restore();
    drawFollowLines(layer, lin);
  }

  drawFixedLines();
  drawLineEditingPoints();
}

// Apply the same ordered space lineage the renderer compiles to ffmpeg.
function drawLayerContent(c, video, media, layer, lin, tipRec) {
  const currentW = tipRec.w, currentH = tipRec.h;
  // Clip to the tip bounds so transformed content never spills its window.
  c.save();
  c.beginPath(); c.rect(0, 0, currentW, currentH); c.clip();

  // The composite transform maps display coords into tip coords.
  const M = tipRec.matrix; // [a,b,c,d,e,f] column form
  c.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
  drawDisplayFrame(c, video, media);
  c.restore();
}

function drawDisplayFrame(c, video, media) {
  // coded source pixels -> upright, square-pixel display frame. The matrix is
  // the same geometry the renderer's transpose/scale filters implement, so the
  // preview cannot drift from the export (rotation metadata + PAR correction).
  c.save();
  const M = T.codedToDisplayMatrix(media);
  c.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
  c.drawImage(video, 0, 0, media.width, media.height);
  c.restore();
}

function drawCanvasGrid(W, H) {
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  const step = 80;
  ctx.beginPath();
  for (let x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
}

function strokePoints(points, color, thickness) {
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
}

function drawFollowLines(layer, lin) {
  for (const line of state.project.lines) {
    if (line.mode !== 'follow' || line.layerId !== layer.id) continue;
    // display -> tip through the lineage, then tip -> output placement; the
    // same overlay path the renderer uses for the follow-line PNG.
    const pts = T.followLineToOutput(lin, layer.placement, line.points);
    strokePoints(pts, line.color, line.thickness);
  }
}

function drawFixedLines() {
  for (const line of state.project.lines) {
    if (line.mode !== 'fixed') continue;
    strokePoints(line.points, line.color, line.thickness);
  }
}

function drawLineEditingPoints() {
  for (const line of state.project.lines) {
    const pts = line.mode === 'fixed' ? line.points : mapFollowToOutput(line);
    ctx.fillStyle = '#fff';
    for (const [x, y] of pts) {
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function mapFollowToOutput(line) {
  const layer = state.project.layers.find((l) => l.id === line.layerId);
  if (!layer) return [];
  const lin = T.computeLineage(state.project.media[layer.mediaId], layer.steps);
  return T.followLineToOutput(lin, layer.placement, line.points);
}

// ------------------------------------------------------- line placement ---
$('addFollowLine').onclick = () => {
  const layer = selectedLayer();
  if (!layer) { alert('先选择要跟随的图层'); return; }
  state.drawMode = 'follow';
  state.selectedLineId = null;
  const line = {
    id: `line_${Date.now()}`, mode: 'follow', layerId: layer.id, inSpace: 'display',
    points: [[50, 50], [300, 300]], color: '#ffff00', thickness: 5,
  };
  state.project.lines.push(line);
  state.selectedLineId = line.id;
  renderLineList(); draw();
};

$('addFixedLine').onclick = () => {
  state.drawMode = 'fixed';
  const line = {
    id: `line_${Date.now()}`, mode: 'fixed', inSpace: 'output',
    points: [[200, 100], [600, 100]], color: '#00ffff', thickness: 5,
  };
  state.project.lines.push(line);
  state.selectedLineId = line.id;
  renderLineList(); draw();
};

function renderLineList() {
  const ul = $('lineList');
  ul.innerHTML = '';
  state.project.lines.forEach((line) => {
    const li = document.createElement('li');
    if (line.id === state.selectedLineId) li.className = 'selected';
    const where = line.mode === 'follow'
      ? `跟随 ${state.project.layers.find((l) => l.id === line.layerId)?.name || '?'}（display 空间）`
      : '画布固定（output 空间）';
    li.innerHTML = `<span class="color-dot" style="background:${line.color}"></span>
      <strong>${where}</strong>
      <div class="meta">${line.points.length} 点 · 线宽 ${line.thickness}</div>
      <div class="row">
        <input type="color" value="${line.color}" data-line-color="${line.id}">
        <button data-line-del="${line.id}" class="danger">删</button>
      </div>`;
    li.onclick = () => { state.selectedLineId = line.id; renderLineList(); };
    ul.appendChild(li);
  });
  ul.querySelectorAll('[data-line-color]').forEach((el) => {
    el.onclick = (e) => e.stopPropagation();
    el.onchange = (e) => {
      const line = state.project.lines.find((l) => l.id === el.dataset.lineColor);
      line.color = e.target.value; draw();
    };
  });
  ul.querySelectorAll('[data-line-del]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      state.project.lines = state.project.lines.filter((l) => l.id !== b.dataset.lineDel);
      renderLineList(); draw();
    };
  });
}

// Click on the canvas appends a point to the selected line, in the correct space.
canvas.addEventListener('click', (e) => {
  const line = state.project.lines.find((l) => l.id === state.selectedLineId);
  if (!line) return;
  // device window -> project output frame (undo preview zoom)
  const [outX, outY] = T.deviceToProject(
    e.clientX, e.clientY, canvas.getBoundingClientRect(),
    state.project.ui.previewZoom
  );
  if (line.mode === 'fixed') {
    line.points.push([round(outX), round(outY)]);
  } else {
    const layer = state.project.layers.find((l) => l.id === line.layerId);
    const lin = T.computeLineage(state.project.media[layer.mediaId], layer.steps);
    // output -> tip (undo placement) -> display (inverse lineage)
    const [tipX, tipY] = T.outputToTip(layer.placement, outX, outY);
    const [dx, dy] = T.mapSpaceToDisplay(lin, lin.tip, tipX, tipY);
    line.points.push([round(dx), round(dy)]);
  }
  draw(); renderLineList();
});

const round = (v) => Math.round(v);

// ------------------------------------------------------------- timeline ---
const tl = $('timeline');
const tlCtx = tl.getContext('2d');

function drawTimeline() {
  const W = tl.clientWidth || 800;
  const H = 120;
  tl.width = W;
  const dur = state.project.output.duration;
  tlCtx.fillStyle = '#0d1117';
  tlCtx.fillRect(0, 0, W, H);
  const xOf = (t) => (t / dur) * W;

  tlCtx.strokeStyle = 'rgba(255,255,255,0.15)';
  tlCtx.fillStyle = '#8b949e';
  tlCtx.font = '10px sans-serif';
  for (let t = 0; t <= dur; t += 0.5) {
    const x = xOf(t);
    tlCtx.beginPath(); tlCtx.moveTo(x, 0); tlCtx.lineTo(x, H); tlCtx.stroke();
    tlCtx.fillText(`${t}s`, x + 2, 12);
  }

  state.project.layers.forEach((layer, i) => {
    const y = 24 + i * 22;
    const x0 = xOf(layer.interval.start), x1 = xOf(layer.interval.end);
    tlCtx.fillStyle = layer.id === state.selectedLayerId ? '#2f81f7' : '#304a6e';
    tlCtx.fillRect(x0, y, Math.max(4, x1 - x0), 16);
    tlCtx.fillStyle = '#fff';
    tlCtx.fillText(layer.name, x0 + 6, y + 12);
    // handles
    tlCtx.fillStyle = '#f7812f';
    tlCtx.fillRect(x0 - 3, y, 6, 16);
    tlCtx.fillRect(x1 - 3, y, 6, 16);
  });
}

tl.addEventListener('mousedown', (e) => {
  const rect = tl.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const dur = state.project.output.duration;
  const t = (x / tl.width) * dur;
  const row = Math.floor((e.clientY - rect.top - 24) / 22);
  const layer = state.project.layers[row];
  if (!layer) return;
  const distStart = Math.abs(t - layer.interval.start);
  const distEnd = Math.abs(t - layer.interval.end);
  state.timelineDrag = {
    layerId: layer.id,
    edge: distStart < distEnd ? 'start' : 'end',
  };
});
window.addEventListener('mousemove', (e) => {
  if (!state.timelineDrag) return;
  const rect = tl.getBoundingClientRect();
  const t = clamp(((e.clientX - rect.left) / tl.width) * state.project.output.duration, 0,
    state.project.output.duration);
  const layer = state.project.layers.find((l) => l.id === state.timelineDrag.layerId);
  layer.interval[state.timelineDrag.edge] = Math.round(t * 10) / 10;
  if (layer.interval.end < layer.interval.start) {
    layer.interval[state.timelineDrag.edge] = layer.interval.start;
  }
  drawTimeline();
});
window.addEventListener('mouseup', () => {
  if (state.timelineDrag) { state.timelineDrag = null; renderLayerList(); renderInspector(); }
});

// ----------------------------------------------------- canvas/toolbar UI ---
$('previewZoom').oninput = (e) => {
  state.project.ui.previewZoom = Number(e.target.value);
  $('zoomLabel').textContent = `${state.project.ui.previewZoom.toFixed(2)}×`;
  draw();
};
$('showGrid').onchange = draw;

for (const [id, key] of [['outW', 'width'], ['outH', 'height'], ['outFps', 'fps']]) {
  $(id).onchange = (e) => { state.project.output[key] = Number(e.target.value); draw(); };
}
$('outDur').onchange = (e) => {
  state.project.output.duration = Number(e.target.value); drawTimeline();
};
$('outBg').onchange = (e) => { state.project.output.bgColor = e.target.value; draw(); };

$('addLayer').onclick = addLayer;
$('fileInput').onchange = (e) => {
  for (const f of e.target.files) uploadMedia(f);
  e.target.value = '';
};

// --------------------------------------------------- save / load / export ---
function syncProjectName() {
  state.project.name = $('projectName').value || 'Untitled';
}

$('newProject').onclick = () => location.reload();

$('saveProject').onclick = async () => {
  syncProjectName();
  const { saved } = await api('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.project),
  });
  $('jobStatus').textContent = `已保存工程：${saved}`;
  refreshProjectPicker();
};

async function refreshProjectPicker() {
  const { projects } = await api('/api/projects');
  const sel = $('projectPicker');
  sel.innerHTML = projects.map((p) => `<option>${p}</option>`).join('');
}

$('loadProjectBtn').onclick = async () => {
  const name = $('projectPicker').value;
  if (!name) return;
  const p = await api(`/api/projects/${name}`);
  state.project = p;
  for (const id of Object.keys(p.media)) {
    state.mediaIndex.push({ mediaId: id, media: p.media[id] });
    loadVideoElement(id);
  }
  state.selectedLayerId = p.layers[0]?.id || null;
  $('projectName').value = p.name;
  $('outW').value = p.output.width; $('outH').value = p.output.height;
  $('outFps').value = p.output.fps; $('outDur').value = p.output.duration;
  $('outBg').value = p.output.bgColor;
  $('previewZoom').value = p.ui.previewZoom;
  $('zoomLabel').textContent = `${p.ui.previewZoom.toFixed(2)}×`;
  renderMediaList(); renderLayerList(); renderInspector(); renderLineList();
  drawTimeline(); draw();
};

$('exportBtn').onclick = async () => {
  syncProjectName();
  $('jobStatus').textContent = '正在后台渲染…';
  const { jobId } = await api('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.project),
  });
  pollJob(jobId);
};

function pollJob(jobId) {
  const timer = setInterval(async () => {
    const job = await api(`/api/render/jobs/${jobId}`);
    if (job.status === 'running') {
      $('jobStatus').textContent = `渲染中… ${jobId}`;
    } else if (job.status === 'done') {
      clearInterval(timer);
      $('jobStatus').innerHTML =
        `完成：<a href="${job.output}" target="_blank">下载合成视频</a>`;
    } else {
      clearInterval(timer);
      $('jobStatus').textContent = `渲染失败：${job.error}`;
      console.error(job.log);
    }
  }, 1000);
}

// ---------------------------------------------------------------- boot ----
function boot() {
  refreshProjectPicker();
  renderLayerList();
  renderLineList();
  drawTimeline();
  const loop = () => { draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
boot();
