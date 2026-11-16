'use strict';

// Revert detection (C-24, "All Code Is Slop (Except Mine)" 13:26-14:46):
// the revert rate of delivered work is a quality anchor that needs no human
// input. A git `Revert "<subject>"` commit is matched to a DELIVERED Run when
// it reverts that Run's receipt head (by sha) or a commit with the same
// subject (squash merges change the sha but keep the subject).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { runsDir } = require('./run-state.js');

function git(rootDir, args) {
  try {
    return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return '';
  }
}

function deliveredRuns(rootDir) {
  let names = [];
  try {
    names = fs.readdirSync(runsDir(rootDir), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
  const runs = [];
  for (const runId of names) {
    const dir = path.join(runsDir(rootDir), runId);
    let state = null;
    let receipt = null;
    try {
      state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    } catch {
      continue;
    }
    if (state.state !== 'DELIVERED') continue;
    try {
      receipt = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
    } catch {
      receipt = null;
    }
    const head = receipt?.head?.sha || null;
    const subject = head ? git(rootDir, ['log', '-1', '--format=%s', head]).trim() : '';
    runs.push({ runId, head, subject });
  }
  return runs;
}

function revertCommits(rootDir) {
  const out = git(rootDir, ['log', '--all', '-E', '--grep=^Revert "', '--format=%H%x1f%s%x1f%b%x1e']);
  return out.split('\x1e').map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
    const [sha, subject, body] = chunk.split('\x1f');
    const reverted = (body || '').match(/This reverts commit ([0-9a-f]{7,40})/);
    const original = (subject || '').match(/^Revert "(.+)"$/);
    return { sha, revertedSha: reverted ? reverted[1] : null, originalSubject: original ? original[1] : null };
  });
}

function detectReverts(rootDir) {
  const runs = deliveredRuns(rootDir);
  const reverts = revertCommits(rootDir);
  const reverted = [];
  for (const run of runs) {
    const hit = reverts.find((revert) => (run.head && revert.revertedSha && (run.head.startsWith(revert.revertedSha) || revert.revertedSha.startsWith(run.head)))
      || (run.subject && revert.originalSubject === run.subject));
    if (hit) {
      const files = run.head ? git(rootDir, ['show', '--name-only', '--format=', run.head]).split('\n').filter(Boolean) : [];
      reverted.push({ runId: run.runId, revertSha: hit.sha, location: files[0] || run.runId });
    }
  }
  return { delivered: runs.length, reverted, rate: runs.length ? Math.round((reverted.length / runs.length) * 1000) / 1000 : 0 };
}

module.exports = { detectReverts };
