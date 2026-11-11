'use strict';

// Builds and renders a realistic dance-lesson composite from the four
// verifiable fixtures, exercising every feature end to end:
//   full-body master (mirrored), transparent foot close-up, rotated portrait
//   phone shot, non-square-PAR clip, follow + fixed reference lines, opacity,
//   timeline intervals and both source-end policies.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { probeMedia } = require('../engine/media');
const { createProject, saveProject } = require('../engine/project');
const { render } = require('../engine/render');

const BIN = path.join(os.homedir(), '.local', 'bin');
const FX = path.resolve(__dirname, 'fixtures');
const OUT_DIR = path.resolve(__dirname, '..', 'data', 'renders');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const master = probeMedia(path.join(BIN, 'ffprobe'), path.join(FX, 'grid_master.mp4'));
  const portrait = probeMedia(path.join(BIN, 'ffprobe'), path.join(FX, 'portrait_rot.mp4'));
  const ntsc = probeMedia(path.join(BIN, 'ffprobe'), path.join(FX, 'ntsc_par.mp4'));
  const foot = probeMedia(path.join(BIN, 'ffprobe'), path.join(FX, 'foot_alpha.mov'));

  const project = createProject('demo_dance_lesson');
  project.output = { width: 1280, height: 720, fps: 30, bgColor: '#101418', duration: 4 };

  project.media = { m_master: master, m_phone: portrait, m_ntsc: ntsc, m_foot: foot };

  // Bottom: mirrored full-body master, cropped to the central 960 columns.
  project.layers.push({
    id: 'L_master', name: '全身演示（镜像+裁切）', mediaId: 'm_master',
    steps: [
      { id: 'mir', op: 'mirror', inSpace: 'display' },
      { id: 'crop', op: 'crop', inSpace: 'mir', rect: { x: 160, y: 0, w: 960, h: 720 } },
    ],
    placement: { x: 0, y: 0 }, opacity: 1,
    interval: { start: 0, end: 4 }, endPolicy: 'hide',
  });

  // Transparent foot close-up, semi-transparent, held as a freeze after 1.5s.
  project.layers.push({
    id: 'L_foot', name: '局部脚步（透明+静帧）', mediaId: 'm_foot',
    steps: [], placement: { x: 30, y: 430 }, opacity: 0.85,
    interval: { start: 0.5, end: 3.8 }, endPolicy: 'freeze',
  });

  // Rotated portrait phone shot as a picture-in-picture, delayed start.
  project.layers.push({
    id: 'L_phone', name: '竖拍手机（旋转元数据）', mediaId: 'm_phone',
    steps: [{ id: 'z', op: 'zoom', inSpace: 'display', factor: 0.3 }],
    placement: { x: 940, y: 30 }, opacity: 1,
    interval: { start: 1, end: 4 }, endPolicy: 'hide',
  });

  // Non-square-PAR reference clip, small inset proving PAR correction.
  project.layers.push({
    id: 'L_ntsc', name: '非方像素参考（PAR 修正）', mediaId: 'm_ntsc',
    steps: [], placement: { x: 940, y: 380 }, opacity: 0.95,
    interval: { start: 0, end: 2.5 }, endPolicy: 'hide',
  });

  // Follow line: defined in the master's display space, flips with the body.
  project.lines.push({
    id: 'line_follow', mode: 'follow', layerId: 'L_master', inSpace: 'display',
    points: [[240, 60], [240, 660]], color: '#ffd400', thickness: 6,
  });

  // Fixed canvas centre line: stays put regardless of any layer mirroring.
  project.lines.push({
    id: 'line_fixed', mode: 'fixed', inSpace: 'output',
    points: [[640, 0], [640, 720]], color: '#00e5ff', thickness: 4,
  });

  const saved = saveProject(path.resolve(__dirname, '..', 'data', 'projects'), project);
  console.log('project saved:', saved);

  const out = path.join(OUT_DIR, 'demo_dance_lesson.mp4');
  await render(project, out, { binDir: BIN });
  const info = probeMedia(path.join(BIN, 'ffprobe'), out);
  console.log('rendered:', out);
  console.log(`output ${info.width}x${info.height} @ ${info.fps}fps, duration ${info.duration}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
