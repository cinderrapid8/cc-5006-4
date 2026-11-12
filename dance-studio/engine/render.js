'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeLineage } = require('./transform');
const { compileGraph, timelineDuration } = require('./filters');

// Render a validated project to an actual composite video.
//   opts.binDir   directory holding ffmpeg/ffprobe
//   opts.onLog    optional callback(level, msg)
function render(project, outputFile, opts = {}) {
  return new Promise((resolve, reject) => {
    const binDir = opts.binDir || path.join(os.homedir(), '.local', 'bin');
    const ffmpeg = path.join(binDir, 'ffmpeg');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dance-render-'));

    const lineages = {};
    for (const layer of project.layers) {
      lineages[layer.id] = computeLineage(project.media[layer.mediaId], layer.steps || []);
    }

    const plan = compileGraph(project, lineages, { tmpDir });
    const args = ['-hide_banner', '-nostdin', '-y', '-noautorotate'];
    for (const inp of plan.inputs) {
      if (inp.streamLoop) args.push('-stream_loop', '-1');
      if (inp.loop) args.push('-loop', '1');
      args.push('-i', inp.file);
    }
    args.push('-filter_complex', readFilterScript(tmpDir, plan.filters));
    args.push('-map', `[${plan.finalLabel}]`);

    const ext = path.extname(outputFile).toLowerCase();
    if (ext === '.webm') {
      args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
        '-b:v', '6M', '-auto-alt-ref', '0');
    } else if (ext === '.mov') {
      args.push('-c:v', 'qtrle', '-pix_fmt', 'argb');
    } else {
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-crf', '18', '-preset', 'medium');
    }
    args.push('-r', String(project.output.fps),
      '-t', timelineDuration(project).toFixed(3),
      outputFile);

    const proc = spawn(ffmpeg, args, { cwd: tmpDir });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      const msg = d.toString();
      stderr += msg;
      if (opts.onLog) opts.onLog('ffmpeg', msg.trim());
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ outputFile, tmpDir, args, lineages });
      } else {
        reject(new Error(`ffmpeg exited ${code}\n${tail(stderr)}`));
      }
    });
  });
}

function readFilterScript(tmpDir, filters) {
  // Written to disk for debugging; ffmpeg 7 accepts the graph as one argument.
  const f = path.join(tmpDir, 'graph.txt');
  fs.writeFileSync(f, filters.join(';\n') + ';\n');
  return filters.join(';');
}

function tail(s, n = 3000) {
  return s.length > n ? s.slice(-n) : s;
}

module.exports = { render };
