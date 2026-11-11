'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

// Project schema (all coordinates are named-space explicit):
//
// output: { width, height, fps, bgColor }
// media:  { [mediaId]: media descriptor from engine/media.js }
// layers: ordered bottom-to-top; each:
//   id, name, mediaId,
//   steps: ordered transforms, each naming its input space:
//     { id, op:'mirror', inSpace }
//     { id, op:'crop',   inSpace, rect:{x,y,w,h} }   // rect coords in inSpace
//     { id, op:'zoom',   inSpace, factor }
//   placement: { x, y }            // tip-space top-left lands here in output
//   opacity: 0..1
//   interval: { start, end }       // seconds on the project timeline
//   endPolicy: 'hide' | 'freeze'   // behaviour when source duration is past
// lines:
//   { id, mode:'follow'|'fixed', layerId?(follow only),
//     points:[[x,y],...], color, thickness,
//     inSpace: 'display' | 'output' }   // follow => display space of its layer;
//                                       // fixed  => output canvas space
// ui: { previewZoom }               // display-only; never used by the renderer
function createProject(name) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: name || 'Untitled dance lesson',
    output: { width: 1280, height: 720, fps: 30, bgColor: '#101418', duration: null },
    media: {},
    layers: [],
    lines: [],
    ui: { previewZoom: 1 },
  };
}

function validateProject(p) {
  if (!p || p.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('unsupported project schema');
  }
  for (const layer of p.layers) {
    if (!p.media[layer.mediaId]) {
      throw new Error(`layer ${layer.id} references missing media ${layer.mediaId}`);
    }
    let tip = 'display';
    for (const s of layer.steps || []) {
      if (s.inSpace !== tip) {
        throw new Error(
          `layer ${layer.id} step ${s.id}: inSpace "${s.inSpace}" != current tip "${tip}"`
        );
      }
      if (s.op === 'mirror') tip = s.id;
      else if (s.op === 'crop') {
        if (!s.rect || s.rect.w <= 0 || s.rect.h <= 0) {
          throw new Error(`layer ${layer.id} crop ${s.id} needs positive rect`);
        }
        tip = s.id;
      } else if (s.op === 'zoom') {
        if (!(s.factor > 0)) throw new Error(`layer ${layer.id} zoom ${s.id} bad factor`);
        tip = s.id;
      } else throw new Error(`layer ${layer.id} unknown op ${s.op}`);
    }
    if (layer.opacity === undefined) layer.opacity = 1;
    if (!(layer.opacity >= 0 && layer.opacity <= 1)) {
      throw new Error(`layer ${layer.id} opacity out of range`);
    }
    if (!layer.endPolicy) layer.endPolicy = 'hide';
    if (!['hide', 'freeze'].includes(layer.endPolicy)) {
      throw new Error(`layer ${layer.id} endPolicy must be hide|freeze`);
    }
  }
  for (const line of p.lines) {
    if (line.mode === 'follow') {
      if (!line.layerId || !p.layers.find((l) => l.id === line.layerId)) {
        throw new Error(`follow line ${line.id} needs a valid layerId`);
      }
      if (line.inSpace !== 'display') {
        throw new Error(`follow line ${line.id} must use display-space coords`);
      }
    } else if (line.mode === 'fixed') {
      if (line.inSpace !== 'output') {
        throw new Error(`fixed line ${line.id} must use output-space coords`);
      }
    } else throw new Error(`line ${line.id} mode must be follow|fixed`);
  }
  return p;
}

function saveProject(dir, p) {
  validateProject(p);
  const file = path.join(dir, `${p.name.replace(/[^\w.-]+/g, '_')}.dance.json`);
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
  return file;
}

function loadProject(file) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  return validateProject(p);
}

module.exports = {
  SCHEMA_VERSION,
  createProject,
  validateProject,
  saveProject,
  loadProject,
};
