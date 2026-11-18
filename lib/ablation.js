'use strict';

// Harness ablation for bench (C-08, learn-harness-engineering L02/L12):
// switch one gate component off inside a bench scenario repo to measure
// whether it still earns its cost. Honoured only when bench set it up (env
// AEL_BENCH_MODE + AEL_ABLATE and a marker file bench wrote into the repo),
// and every skip is logged to the Run so it can never pass silently.

const fs = require('fs');
const path = require('path');
const { runsDir } = require('./run-state.js');

const COMPONENTS = Object.freeze(['integrity', 'comments', 'l3', 'l1', 'smoke', 'rules', 'proofs']);
const MARKER = path.join('.ai-engineering-loop', 'bench-ablation.json');

function requested(env = process.env) {
  return String(env.AEL_ABLATE || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function writeMarker(repo, components) {
  fs.mkdirSync(path.join(repo, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(repo, MARKER), `${JSON.stringify({ schemaVersion: 1, components }, null, 2)}\n`);
}

function ablated(rootDir, component, runId = null, env = process.env) {
  if (!env.AEL_BENCH_MODE || !requested(env).includes(component)) return false;
  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(rootDir, MARKER), 'utf8'));
  } catch {
    return false;
  }
  if (!Array.isArray(marker?.components) || !marker.components.includes(component)) return false;
  if (runId) {
    try {
      fs.appendFileSync(path.join(runsDir(rootDir), runId, 'ablation.log'), `${JSON.stringify({ component, at: new Date().toISOString() })}\n`);
    } catch {
      // Run directory missing; the bench result still records the ablation.
    }
  }
  return true;
}

function validateComponents(list) {
  const unknown = list.filter((item) => !COMPONENTS.includes(item));
  if (unknown.length) {
    throw Object.assign(new Error(`Unknown --without component(s): ${unknown.join(', ')}. Use: ${COMPONENTS.join(', ')}`), { code: 'BENCH_USAGE' });
  }
  return list;
}

module.exports = { COMPONENTS, MARKER, ablated, requested, validateComponents, writeMarker };
