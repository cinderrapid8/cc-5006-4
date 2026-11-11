'use strict';

// Generates the four verifiable dance-lesson fixtures:
//   grid_master.mp4   1280x720, L/R letter marks, 160px known grid, moving step
//   portrait_rot.mp4  coded 1920x1080 + rotation=90 metadata (displays 1080x1920)
//   ntsc_par.mp4      coded 720x480, SAR 10/11 (display 654x480), square-grid scene
//   foot_alpha.mov    640x480 qtrle RGBA, soft semi-transparent "foot" mark
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const bmp = require('../engine/bitmap');
const { patchRotation } = require('../engine/mp4rotate');

const OUT = path.join(__dirname, 'fixtures');
const BIN = path.join(process.env.HOME, '.local', 'bin');

function pipeFrames(opts) {
  const { w, h, fps, frames, args, file } = opts;
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const ff = spawn(path.join(BIN, 'ffmpeg'),
      ['-hide_banner', '-y', '-f', 'image2pipe', '-vcodec', opts.rawCodec || 'ppm',
       '-r', String(fps), '-i', '-', ...args, file]);
    ff.on('error', reject);
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d; });
    ff.on('close', (code) => {
      if (code === 0) resolve(file);
      else reject(new Error(`encode ${path.basename(file)} failed: ${stderr.slice(-1500)}`));
    });
    for (let t = 0; t < frames; t++) {
      const f = bmp.makeFrame(w, h, opts.bg || [16, 20, 24, 255]);
      opts.draw(f, t);
      ff.stdin.write(opts.rawCodec === 'pam' ? pamBuffer(f) : ppmBuffer(f));
    }
    ff.stdin.end();
  });
}

function ppmBuffer(f) {
  const header = Buffer.from(`P6\n${f.w} ${f.h}\n255\n`, 'ascii');
  const body = Buffer.alloc(f.w * f.h * 3);
  for (let i = 0; i < f.w * f.h; i++) {
    body[i * 3] = f.data[i * 4];
    body[i * 3 + 1] = f.data[i * 4 + 1];
    body[i * 3 + 2] = f.data[i * 4 + 2];
  }
  return Buffer.concat([header, body]);
}

function pamBuffer(f) {
  return Buffer.concat([
    Buffer.from(`P7\nWIDTH ${f.w}\nHEIGHT ${f.h}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`),
    f.data,
  ]);
}

async function main() {
  // ---- 1. full-body master: letters L/R + known grid + moving foot step ----
  await pipeFrames({
    file: path.join(OUT, 'grid_master.mp4'),
    w: 1280, h: 720, fps: 30, frames: 60,
    args: ['-vf', 'setsar=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20'],
    draw(f, t) {
      bmp.drawGrid(f, 160, [60, 70, 80, 255], true);
      // L on the viewer's LEFT edge, R on the viewer's RIGHT edge
      bmp.drawText(f, 'L', 24, 300, 8, [0, 200, 255, 255]);
      bmp.drawText(f, 'R', f.w - 24 - bmp.textWidth('R', 8), 300, 8, [255, 120, 0, 255]);
      // coloured corner anchors (TL green, BR magenta)
      bmp.fillRect(f, 0, 0, 24, 24, [0, 255, 0, 255]);
      bmp.fillRect(f, f.w - 24, f.h - 24, 24, 24, [255, 0, 255, 255]);
      // moving step marker: travels left->right across 2 seconds
      const x = 80 + t * 18;
      bmp.fillRect(f, x, 520, 60, 90, [230, 60, 60, 255]);
      bmp.drawText(f, `F${String(t).padStart(2, '0')}`, 20, 20, 3, [230, 230, 230, 255]);
    },
  });

  // ---- 2. portrait phone shot, coded landscape with rotation=90 metadata --
  // Pixels are encoded landscape (1920x1080); the mp4rotate patch writes a
  // real tkhd display matrix telling players to turn the frame clockwise 90.
  const portraitFile = path.join(OUT, 'portrait_rot.mp4');
  await pipeFrames({
    file: portraitFile,
    w: 1920, h: 1080, fps: 30, frames: 45,
    args: ['-vf', 'setsar=1', '-c:v', 'libx264',
           '-pix_fmt', 'yuv420p', '-crf', '20'],
    draw(f, t) {
      bmp.drawGrid(f, 240, [70, 70, 90, 255], false);
      // Clockwise-90 display: coded (0, h-1) -> display (0, 0) top-left.
      bmp.fillRect(f, 0, f.h - 80, 80, 80, [0, 255, 0, 255]);
      // coded (w-1, 0) -> display bottom-right.
      bmp.fillRect(f, f.w - 80, 0, 80, 80, [255, 0, 255, 255]);
      // L letter sits at display left; R at display right.
      bmp.drawText(f, 'L', 40, f.h - 200, 10, [0, 200, 255, 255]);
      bmp.drawText(f, 'R', f.w - 120, 120, 10, [255, 120, 0, 255]);
      bmp.drawText(f, `F${t}`, f.w / 2 - 40, f.h / 2, 4, [230, 230, 230, 255]);
    },
  });
  patchRotation(portraitFile, 90);

  // ---- 3. non-square pixels: coded 720x480, SAR 10/11 -> 654x480 display --
  // Draw a coded grid of 90x80 cells (8 columns x 6 rows). After PAR
  // correction cells should measure ~81.8 x 80 display px (near-square).
  await pipeFrames({
    file: path.join(OUT, 'ntsc_par.mp4'),
    w: 720, h: 480, fps: 30, frames: 45,
    args: ['-vf', 'setsar=10/11', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20'],
    draw(f, t) {
      bmp.drawGrid(f, 1, [0, 0, 0, 0], false); // noop
      for (let x = 0; x <= f.w; x += 90) bmp.fillRect(f, x, 0, 2, f.h, [90, 110, 140, 255]);
      for (let y = 0; y <= f.h; y += 80) bmp.fillRect(f, 0, y, f.w, 2, [90, 110, 140, 255]);
      bmp.drawText(f, 'L', 12, 200, 6, [0, 200, 255, 255]);
      bmp.drawText(f, 'R', f.w - 60, 200, 6, [255, 120, 0, 255]);
      const x = 40 + t * 12;
      bmp.fillRect(f, x, 340, 40, 60, [230, 60, 60, 255]);
    },
  });

  // ---- 4. transparent foot close-up with soft (anti-aliased) alpha edge ---
  await pipeFrames({
    file: path.join(OUT, 'foot_alpha.mov'),
    w: 640, h: 480, fps: 30, frames: 45, rawCodec: 'pam',
    args: ['-vf', 'setsar=1', '-c:v', 'qtrle', '-pix_fmt', 'argb'],
    draw(f, t) {
      // transparent background (makeFrame bg alpha 0)
      f.data.fill(0);
      const cx = 320 + Math.sin(t / 6) * 60;
      const cy = 260;
      // soft disc: feathered alpha ring, fully opaque core — reveals any
      // dark-fringe premultiplication mistake at the edge.
      for (let y = cy - 130; y <= cy + 130; y++) {
        for (let x = cx - 150; x <= cx + 150; x++) {
          const d = Math.hypot((x - cx) / 1.2, y - cy);
          let a = 0;
          if (d <= 100) a = 255;
          else if (d <= 118) a = Math.round(255 * (118 - d) / 18);
          if (a > 0) bmp.setPx(f, x, y, [80, 220, 160, a]);
        }
      }
      bmp.drawText(f, 'FOOT', cx - 70, cy - 20, 4, [255, 255, 255, 255]);
    },
  });

  console.log('fixtures written to', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
