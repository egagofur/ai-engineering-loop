'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
  const hash = crypto.createHash('sha256').update(content).digest('hex');
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

function renderClaimedVsRealityTemplate(goal) {
  const lines = [
    '# Claimed vs Reality',
    '',
    '> Generated from the frozen Goal Contract. Fill Claimed and Reality only after implementation and verification. Reality must cite observed command output; this template is not verification evidence.',
    '',
    '| AC | Claimed | Reality from command log |',
    '|---|---|---|'
  ];
  for (const criterion of goal.acceptanceCriteria) {
    const evidence = markdownCell(criterion.evidenceRequired);
    const failures = (criterion.failureCases || []).map(markdownCell).filter(Boolean).join('; ');
    const description = [
      `${criterion.id}: ${markdownCell(criterion.statement)}`,
      evidence ? `Evidence: ${evidence}` : '',
      failures ? `Failure cases: ${failures}` : ''
    ].filter(Boolean).join(' — ');
    lines.push(`| ${markdownCell(description)} |  |  |`);
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
    fs.writeFileSync(descriptor, renderClaimedVsRealityTemplate(goal));
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
    rows.push({
      ac: cells[0],
      claimed: cells[1],
      reality: cells[2]
    });
  }
  return { rows };
}

function readyForDa(markdown) {
  const { rows } = parseClaimedVsReality(markdown);
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const reality = (row.reality || '').trim();
    if (!reality) return false;
    if (/^seems green$/i.test(reality)) return false;
    if (!(row.claimed || '').trim()) return false;
    return true;
  });
}

module.exports = {
  createClaimedVsRealityTemplate,
  parseClaimedVsReality,
  readyForDa
};
