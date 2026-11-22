'use strict';

// `refresh --garden`: report stale project knowledge. Dry-run unless --yes.
// Runs are never deleted. Feature-map edits move fully dead rows aside and
// keep a backup of the file.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pruneStored, DEFAULT_MAX_AGE_RUNS } = require('./learn.js');
const { FEATURE_MAP_FILE, parseFeatureMap } = require('./feature-map.js');
const { matchesGlob } = require('./impact-map.js');

const REVIEW_DAYS = 7;
const KEEP_DAYS = 30;
const TERMINAL = new Set(['REPORTED', 'DELIVERED', 'ESCALATED', 'CANCELLED']);
const STALE_HEADING = '## Stale (garden)';
const MAP_HEADER = '| Feature | Where (UI or endpoint) | Paths | How to reach | Driver |\n|---|---|---|---|---|';

function trackedFiles(rootDir) {
  try {
    return execFileSync('git', ['ls-files'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024
    }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function rowId(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('|') || /^\|\s*-/.test(trimmed)) return null;
  const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
  if (cells.length < 4 || /^feature$/i.test(cells[0])) return null;
  return cells[0];
}

function readMap(rootDir) {
  try {
    return fs.readFileSync(path.join(rootDir, FEATURE_MAP_FILE), 'utf8');
  } catch {
    return null;
  }
}

function planFeatureMap(rootDir) {
  const files = trackedFiles(rootDir);
  const text = readMap(rootDir);
  if (text == null) return { skipped: files ? null : 'not a git repository', rows: [] };
  if (!files) return { skipped: 'not a git repository', rows: [] };
  const head = text.split(/^## Stale \(garden\)/m)[0];
  const rows = [];
  for (const entry of parseFeatureMap(head)) {
    if (!entry.paths.length) {
      rows.push({ id: entry.id, paths: [], action: 'skip', reason: 'no paths' });
      continue;
    }
    const dead = entry.paths.filter((glob) => !files.some((file) => matchesGlob(file, glob)));
    if (dead.length === entry.paths.length) rows.push({ id: entry.id, paths: dead, action: 'move-to-stale' });
    else if (dead.length) rows.push({ id: entry.id, paths: dead, action: 'report', reason: 'some paths still match' });
  }
  return { skipped: null, rows };
}

function planRuns(rootDir, now) {
  const dir = path.join(rootDir, '.ai-engineering-loop', 'runs');
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(path.join(dir, entry.name, 'state.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!state?.runId || !state.state) continue;
    const at = Date.parse(state.updatedAt || state.createdAt || '');
    if (!Number.isFinite(at)) continue;
    const ageDays = Math.floor((now.getTime() - at) / 86400000);
    if (!TERMINAL.has(state.state) && ageDays >= REVIEW_DAYS) {
      rows.push({
        runId: state.runId,
        state: state.state,
        ageDays,
        action: 'review',
        note: `idle ${ageDays}d. A human can abandon it: ael run --abandon --run ${state.runId} --reason "<why>" --by <name>`
      });
    } else if (TERMINAL.has(state.state) && ageDays >= KEEP_DAYS) {
      rows.push({
        runId: state.runId,
        state: state.state,
        ageDays,
        action: 'keep',
        note: 'left on disk; garden does not delete Run evidence'
      });
    }
  }
  rows.sort((left, right) => right.ageDays - left.ageDays || left.runId.localeCompare(right.runId));
  return rows;
}

function planGarden(rootDir, { maxAgeRuns = DEFAULT_MAX_AGE_RUNS, now = new Date() } = {}) {
  const learned = pruneStored(rootDir, { dryRun: true, maxAgeRuns });
  const features = planFeatureMap(rootDir);
  const runs = planRuns(rootDir, now);
  const writes = [];
  if (learned.pruned.length) {
    writes.push('.ai-engineering-loop/learnings.json', '.ai-engineering-loop/learnings.md');
  }
  if (features.rows.some((row) => row.action === 'move-to-stale')) {
    writes.push('.ai-engineering-loop/feature-map.md', '.ai-engineering-loop/feature-map.md.ael-backup');
  }
  return {
    dryRun: true,
    applied: false,
    learnings: learned.pruned.map((item) => ({ id: item.id, reason: item.reason, action: 'prune' })),
    featureMap: features.rows,
    featureMapSkipped: features.skipped,
    runs,
    writes
  };
}

function moveDeadRows(rootDir, deadIds) {
  if (!deadIds.size) return false;
  const text = readMap(rootDir);
  if (text == null) return false;
  const parts = text.split(/^## Stale \(garden\)/m);
  const moved = [];
  const kept = [];
  for (const line of parts[0].replace(/\s*$/, '').split('\n')) {
    const id = rowId(line);
    if (id && deadIds.has(id)) moved.push(line);
    else kept.push(line);
  }
  if (!moved.length) return false;
  const file = path.join(rootDir, FEATURE_MAP_FILE);
  const backup = `${file}.ael-backup`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  const stale = parts.length > 1
    ? `${STALE_HEADING}${parts.slice(1).join(STALE_HEADING)}`.replace(/\s*$/, '')
    : `${STALE_HEADING}\n\nRows whose paths match no tracked file. Move a row back into the table above when the feature returns.\n\n${MAP_HEADER}`;
  const next = `${kept.join('\n').replace(/\s*$/, '')}\n\n${stale}\n${moved.join('\n')}\n`;
  fs.writeFileSync(file, next);
  return true;
}

function applyGarden(rootDir, options = {}) {
  const plan = planGarden(rootDir, options);
  const written = [];
  if (plan.learnings.length) {
    pruneStored(rootDir, { dryRun: false, maxAgeRuns: options.maxAgeRuns || DEFAULT_MAX_AGE_RUNS });
    written.push('.ai-engineering-loop/learnings.json', '.ai-engineering-loop/learnings.md');
  }
  const deadIds = new Set(plan.featureMap.filter((row) => row.action === 'move-to-stale').map((row) => row.id));
  if (moveDeadRows(rootDir, deadIds)) {
    written.push('.ai-engineering-loop/feature-map.md', '.ai-engineering-loop/feature-map.md.ael-backup');
  }
  return { ...plan, dryRun: false, applied: true, written };
}

module.exports = {
  KEEP_DAYS,
  REVIEW_DAYS,
  applyGarden,
  planGarden
};
