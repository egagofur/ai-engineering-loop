'use strict';

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./fsutil.js');
const { getCurrentRun, loadRun } = require('./run-state.js');

function claimedVsRealityError(message, code = 'CLAIMED_VS_REALITY_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function frozenGoal(rootDir, run) {
  const artifact = run.artifacts?.goalContract;
  if (!artifact?.path || !artifact.sha256) {
    throw claimedVsRealityError('The Goal Contract has not passed the Goal gate.', 'GOAL_NOT_FROZEN');
  }
  const root = fs.realpathSync(rootDir);
  const goalPath = path.resolve(root, artifact.path);
  const relative = path.relative(root, goalPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw claimedVsRealityError('Frozen Goal Contract path escapes the repository.', 'UNSAFE_GOAL_PATH');
  }
  assertNoSymlinkPath(root, goalPath);
  const stat = fs.lstatSync(goalPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw claimedVsRealityError('Frozen Goal Contract must be a regular file.', 'UNSAFE_GOAL_PATH');
  }
  const content = fs.readFileSync(goalPath);
  const hash = sha256(content);
  if (hash !== artifact.sha256) {
    throw claimedVsRealityError('Frozen Goal Contract changed after its gate.', 'STALE_GOAL');
  }
  let goal;
  try {
    goal = JSON.parse(content.toString('utf8'));
  } catch (cause) {
    throw claimedVsRealityError(`Frozen Goal Contract is invalid JSON: ${cause.message}`, 'INVALID_GOAL');
  }
  if (goal.runId !== run.runId || !Array.isArray(goal.acceptanceCriteria) || goal.acceptanceCriteria.length === 0) {
    throw claimedVsRealityError('Frozen Goal Contract has no criteria for this Run.', 'INVALID_GOAL');
  }
  return goal;
}

function assertNoSymlinkPath(root, targetPath) {
  const relative = path.relative(root, targetPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw claimedVsRealityError('Output path must stay inside the repository.', 'UNSAFE_OUTPUT_PATH');
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw claimedVsRealityError(`Repository path crosses a symlink: ${path.relative(root, current)}`, 'UNSAFE_PATH');
      }
    } catch (cause) {
      if (cause.code === 'ENOENT') return;
      throw cause;
    }
  }
}

function renderClaimedVsRealityTemplate(goal, tier = null) {
  const lines = [
    '# Claimed vs Reality',
    '',
    '> Generated from the frozen Goal Contract. Fill Claimed and Reality only after implementation and verification. Reality must cite observed command output; this template is not verification evidence. Layer: L1 static, L2 tests, L3 e2e; "needs L3" rows need L3 or "L3 waived: <reason>".',
    '',
    '| AC | Claimed | Reality from command log | Layer |',
    '|---|---|---|---|'
  ];
  for (const criterion of goal.acceptanceCriteria) {
    const evidence = markdownCell(criterion.evidenceRequired);
    const failures = (criterion.failureCases || []).map(markdownCell).filter(Boolean).join('; ');
    const description = [
      `${criterion.id}: ${markdownCell(criterion.statement)}`,
      evidence ? `Evidence: ${evidence}` : '',
      failures ? `Failure cases: ${failures}` : ''
    ].filter(Boolean).join(' — ');
    const layerHint = criterionNeedsL3(criterion, tier) ? 'needs L3' : '';
    lines.push(`| ${markdownCell(description)} |  |  | ${layerHint} |`);
  }
  return `${lines.join('\n')}\n`;
}

function createClaimedVsRealityTemplate(rootDir, { runId, outputPath } = {}) {
  const run = runId ? loadRun(rootDir, runId) : getCurrentRun(rootDir);
  if (!run) throw claimedVsRealityError('No current Run. Pass --run <id>.', 'NO_CURRENT_RUN');
  const goal = frozenGoal(rootDir, run);
  const root = fs.realpathSync(rootDir);
  const requestedPath = outputPath || '.ai-engineering-loop/tasks/claimed-vs-reality.md';
  if (path.isAbsolute(requestedPath)) {
    throw claimedVsRealityError('Output path must be repository-relative.', 'UNSAFE_OUTPUT_PATH');
  }
  const filePath = path.resolve(root, requestedPath);
  const relative = path.relative(root, filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw claimedVsRealityError('Output path must stay inside the repository.', 'UNSAFE_OUTPUT_PATH');
  }
  assertNoSymlinkPath(root, path.dirname(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const realParent = fs.realpathSync(path.dirname(filePath));
  if (realParent !== root && !realParent.startsWith(`${root}${path.sep}`)) {
    throw claimedVsRealityError('Output path escapes the repository through a symlink.', 'UNSAFE_OUTPUT_PATH');
  }
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'wx', 0o600);
  } catch (cause) {
    if (cause.code === 'EEXIST') {
      throw claimedVsRealityError(
        `Refusing to overwrite ${relative}. Choose --output <new-file> to preserve existing evidence.`,
        'OUTPUT_EXISTS'
      );
    }
    throw cause;
  }
  try {
    fs.writeFileSync(descriptor, renderClaimedVsRealityTemplate(goal, run.tier?.current || null));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return { runId: run.runId, path: relative.split(path.sep).join('/') };
}

function parseClaimedVsReality(markdown) {
  const rows = [];
  if (!markdown || !String(markdown).trim()) return { rows };
  const lines = String(markdown).split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|\s*-+\s*\|/.test(trimmed) || /^\|\s*AC\s*\|/i.test(trimmed)) continue;
    const cells = trimmed.split('|').map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 3) continue;
    const row = {
      ac: cells[0],
      claimed: cells[1],
      reality: cells[2]
    };
    if (cells.length >= 4 && cells[3]) {
      row.layer = cells[3];
    }
    rows.push(row);
  }
  return { rows };
}

// Three-layer termination check (#110, learn-harness-engineering lectures 09/10):
// L1 static (typecheck/lint/build), L2 runtime (unit/related/all tests),
// L3 end-to-end (e2e or the AC's real user flow). Unit tests isolate and mock
// by design, so they cannot prove a cross-component AC.
const LAYER_TOKEN = /^L[123]$/;
const WAIVER = /^L3\s+waived\s*:\s*(.+)$/i;
const MIN_WAIVER_REASON = 15;

function acIdOf(cell) {
  const match = String(cell || '').match(/\bAC-[0-9]+\b/);
  return match ? match[0] : null;
}

function criterionNeedsL3(criterion, tier) {
  return criterion?.crossComponent === true || tier === 'T2';
}

// Parse a Layer cell such as "L2", "L1+L2+L3", or "L2; L3 waived: <reason>".
// Returns { layers, waiver, invalid } where invalid lists unknown tokens.
function parseLayerCell(cell) {
  const layers = new Set();
  const invalid = [];
  let waiver = null;
  const text = String(cell || '').trim();
  if (!text || /^needs L3$/i.test(text)) return { layers, waiver, invalid, empty: true };
  for (const part of text.split(/[;,]/).map((p) => p.trim()).filter(Boolean)) {
    const waived = part.match(WAIVER);
    if (waived) {
      waiver = waived[1].trim();
      continue;
    }
    for (const token of part.split(/[+\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean)) {
      if (LAYER_TOKEN.test(token)) layers.add(token);
      else invalid.push(token);
    }
  }
  return { layers, waiver, invalid, empty: false };
}

// Agent-oriented check: every problem says what is wrong and how to fix it.
// options.goal (frozen Goal Contract) and options.tier switch on the L3
// requirement; without them only the Layer cell syntax is checked, so legacy
// 3-column files keep working.
function checkClaimedVsReality(markdown, { goal = null, tier = null } = {}) {
  const { rows } = parseClaimedVsReality(markdown);
  const problems = [];
  if (rows.length === 0) {
    problems.push('claimed-vs-reality has no AC rows. FIX: scaffold it with `context claimed-vs-reality --run <id>` and fill every row.');
    return { ready: false, problems };
  }
  const hasLayerColumn = /^\s*\|\s*AC\s*\|.*\|\s*Layer\s*\|\s*$/im.test(String(markdown));
  const criteria = new Map((goal?.acceptanceCriteria || []).map((c) => [c.id, c]));
  const effectiveTier = tier || goal?.tier || null;
  for (const row of rows) {
    const label = acIdOf(row.ac) || markdownCell(row.ac).slice(0, 40);
    const reality = (row.reality || '').trim();
    if (!(row.claimed || '').trim()) {
      problems.push(`${label}: Claimed is empty. FIX: state what the change does for this AC.`);
    }
    if (!reality) {
      problems.push(`${label}: Reality is empty. FIX: paste the command and its observed result (exit code, pass count).`);
    } else if (/^seems green$/i.test(reality)) {
      problems.push(`${label}: Reality "seems green" is not evidence. FIX: cite the command output from this iteration.`);
    }
    const layer = parseLayerCell(row.layer);
    if (layer.invalid.length) {
      problems.push(`${label}: Layer has unknown token(s) ${layer.invalid.join(', ')}. FIX: use L1 (static), L2 (runtime tests), L3 (end-to-end), e.g. "L2+L3".`);
    }
    if (layer.waiver !== null && layer.waiver.length < MIN_WAIVER_REASON) {
      problems.push(`${label}: L3 waiver reason is too short. FIX: write "L3 waived: <why no e2e or manual flow could run>" with a concrete reason.`);
    }
    const criterion = criteria.get(acIdOf(row.ac));
    const needsL3 = criterion ? criterionNeedsL3(criterion, effectiveTier) : (effectiveTier === 'T2' && Boolean(goal));
    if (needsL3 && !layer.layers.has('L3') && !(layer.waiver && layer.waiver.length >= MIN_WAIVER_REASON)) {
      const why = criterion?.crossComponent === true ? 'it is marked crossComponent' : `tier ${effectiveTier} requires L1-L3`;
      problems.push(hasLayerColumn
        ? `${label}: needs L3 end-to-end evidence because ${why}; unit/related tests mock the boundaries this AC crosses. FIX: run \`e2e\` (or the AC's real user flow), cite it in Reality and tag Layer "L3", or write "L3 waived: <reason>".`
        : `${label}: needs L3 evidence because ${why}, but the file has no Layer column. FIX: add a 4th column "Layer" and tag this row L3 (or "L3 waived: <reason>").`);
    }
  }
  return { ready: problems.length === 0, problems };
}

function readyForDa(markdown, options) {
  return checkClaimedVsReality(markdown, options).ready;
}

module.exports = {
  checkClaimedVsReality,
  createClaimedVsRealityTemplate,
  criterionNeedsL3,
  loadFrozenGoal: frozenGoal,
  parseLayerCell,
  parseClaimedVsReality,
  readyForDa
};
