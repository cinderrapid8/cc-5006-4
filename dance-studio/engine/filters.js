'use strict';

const path = require('path');
const fs = require('fs');
const space = require('./space');
const png = require('./png');

// ffprobe/ffmpeg rotation convention:
//   rotation 90 means the stored frame must be turned 90 degrees clockwise to
//   display upright. transpose=1 is clockwise 90, transpose=2 c-clockwise 90.
function transposeFor(rotation) {
  switch (rotation) {
    case 0: case 360: return null;
    case 90: return 'transpose=1';
    case 180: return 'transpose=1,transpose=1';
    case 270: return 'transpose=2';
    default: throw new Error(`unsupported rotation ${rotation}`);
  }
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function buildLinePng(file, width, height, lines, projectLines) {
  const cv = png.makeCanvas(width, height);
  for (const line of lines) {
    const spec = projectLines.find((l) => l.id === line.id);
    png.strokePolyline(cv, line.points, line.thickness, spec.color, spec.alpha == null ? 1 : spec.alpha);
  }
  fs.writeFileSync(file, png.encodePng(width, height, cv.data));
}

// Compile a validated project into a concrete ffmpeg invocation plan.
//   project       validated project object
//   lineages      layerId -> space.computeLineage result
//   opts.tmpDir   where reference-line PNGs are written
function compileGraph(project, lineages, opts) {
  const inputs = []; // { file, loop }
  const filters = [];
  const linePngs = [];
  const { width: OW, height: OH, fps, bgColor } = project.output;

  // ---- base canvas -------------------------------------------------------
  const baseLabel = 'base0';
  filters.push(
    `color=c=${esc(bgColor)}:s=${OW}x${OH}:r=${fps}:d=${timelineDuration(project)}[${baseLabel}]`
  );

  let chainTip = baseLabel;

  // ---- layers bottom-to-top ---------------------------------------------
  project.layers.forEach((layer, idx) => {
    const media = project.media[layer.mediaId];
    const inputIndex = inputs.length;
    const iv = layer.interval || { start: 0, end: timelineDuration(project) };
    // hide: mark the input for -stream_loop so the enable window alone
    // controls visibility. freeze: one play-through + tpad clone below.
    const hideNeedsLoop = !media.isImage && media.duration != null &&
      layer.endPolicy === 'hide' && iv.end - iv.start > media.duration;
    inputs.push({ file: media.file, loop: !!media.isImage, streamLoop: hideNeedsLoop });
    const lin = lineages[layer.id];
    const tipRec = lin.spaces.get(lin.tip);
    let label = `l${idx}n`;
    const chain = [];

    // 1) coded -> upright -> square-pixel display space.
    //    -noautorotate on the CLI keeps rotation OUR explicit responsibility.
    chain.push('format=rgba');
    const tr = transposeFor(media.rotation);
    if (tr) chain.push(tr);
    const needsParScale = media.parNum !== media.parDen;
    const uprightW = media.rotation === 90 || media.rotation === 270
      ? media.height : media.width;
    const needsSizeScale = media.displayWidth !== uprightW;
    if (needsParScale || needsSizeScale) {
      chain.push(
        `scale=${media.displayWidth}:${media.displayHeight}:flags=lanczos`,
        'setsar=1'
      );
    } else {
      chain.push('setsar=1');
    }
    filters.push(`[${inputIndex}:v]${chain.join(',')}[${label}]`);

    // 2) ordered user steps; each names its inSpace and operates in that space
    layer.steps.forEach((step, si) => {
      const prev = label;
      label = `l${idx}s${si}`;
      if (step.op === 'mirror') {
        filters.push(`[${prev}]hflip[${label}]`);
      } else if (step.op === 'crop') {
        const r = step.rect;
        filters.push(`[${prev}]crop=${r.w}:${r.h}:${r.x}:${r.y}[${label}]`);
      } else if (step.op === 'zoom') {
        const rec = lin.spaces.get(step.id);
        filters.push(`[${prev}]scale=${rec.w}:${rec.h}:flags=lanczos[${label}]`);
      }
    });

    // 3) follow-lines: mapped out of display space through the layer's lineage
    //    into its tip space, drawn on an RGBA canvas of the tip size.
    const followLines = project.lines.filter(
      (l) => l.mode === 'follow' && l.layerId === layer.id
    );
    if (followLines.length) {
      const mapped = followLines.map((l) => ({
        id: l.id,
        thickness: l.thickness,
        points: space.mapPolyline(lin, lin.tip, l.points),
      }));
      const pngFile = path.join(opts.tmpDir, `lines_follow_${layer.id}.png`);
      buildLinePng(pngFile, tipRec.w, tipRec.h, mapped, project.lines);
      const lineInput = inputs.length;
      inputs.push({ file: pngFile, loop: true });
      linePngs.push(pngFile);
      const overlaid = `l${idx}lines`;
      filters.push(
        `[${lineInput}:v]format=rgba,setpts=N/(${fps}*TB)[l${idx}linecanvas]`,
        `[${label}][l${idx}linecanvas]overlay=0:0:format=auto:eof_action=repeat[${overlaid}]`
      );
      label = overlaid;
    }

    // 4) opacity via straight alpha scaling (no premultiply => no dark edge).
    if (layer.opacity < 1) {
      const o = `l${idx}op`;
      filters.push(
        `[${label}]colorchannelmixer=aa=${layer.opacity.toFixed(4)}[${o}]`
      );
      label = o;
    }

    // 5) source end policy: freeze clones the final frame for the hold time.
    //    (hide loops instead, so the enable window handles disappearance.)
    if (!media.isImage && layer.endPolicy === 'freeze') {
      const srcDur = Number(media.duration || 0);
      const hold = Math.max(0, iv.end - iv.start - srcDur);
      if (hold > 0) {
        const f = `l${idx}freeze`;
        filters.push(
          `[${label}]tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}[${f}]`
        );
        label = f;
      }
    }

    // 6) timeline window + output-space placement.
    const next = idx === project.layers.length - 1 ? 'composed' : `b${idx + 1}`;
    const enable = `between(t,${iv.start.toFixed(3)},${iv.end.toFixed(3)})`;
    // Both policies keep the overlay stream alive to the end of the timeline,
    // so repeat is always safe; the enable expression does the gating.
    const eof = 'repeat';
    filters.push(
      `[${chainTip}][${label}]overlay=${layer.placement.x}:${layer.placement.y}` +
      `:enable='${enable}':eof_action=${eof}:shortest=0[${next}]`
    );
    chainTip = next;
  });

  // ---- fixed canvas lines (output space; unaffected by layer mirroring) --
  const fixedLines = project.lines.filter((l) => l.mode === 'fixed');
  if (fixedLines.length) {
    const pngFile = path.join(opts.tmpDir, 'lines_fixed.png');
    buildLinePng(pngFile, OW, OH, fixedLines.map((l) => ({
      id: l.id, thickness: l.thickness, points: l.points,
    })), project.lines);
    const lineInput = inputs.length;
    inputs.push({ file: pngFile, loop: true });
    linePngs.push(pngFile);
    filters.push(
      `[${lineInput}:v]format=rgba,setpts=N/(${fps}*TB)[fixedcanvas]`,
      `[${chainTip}][fixedcanvas]overlay=0:0:format=auto:eof_action=repeat[composedFinal]`
    );
    chainTip = 'composedFinal';
  } else if (project.layers.length === 0) {
    chainTip = baseLabel;
  } else {
    chainTip = 'composed';
  }

  return { inputs, filters, finalLabel: chainTip, linePngs };
}

function timelineDuration(project) {
  // Explicit project duration wins; otherwise infer from the latest interval.
  if (project.output && project.output.duration) return Number(project.output.duration);
  let d = 0;
  for (const l of project.layers) {
    if (l.interval && l.interval.end > d) d = l.interval.end;
  }
  return Math.max(d, 1);
}

module.exports = { compileGraph, timelineDuration, transposeFor };
