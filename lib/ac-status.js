'use strict';

// Harness-owned AC status (C-07, learn-harness-engineering L08): an AC that
// names its own verify command is `proven` only when that exact command
// passed on the gated diff. Agents cannot set the status; evidence does.

const fs = require('fs');
const path = require('path');
const { runsDir } = require('./run-state.js');

const norm = (text) => String(text || '').trim().replace(/\s+/g, ' ');

function recordedCommands(rootDir, runId) {
  const records = [];
  for (const file of ['verification.json', 'final-verification.json']) {
    try {
      const bundle = JSON.parse(fs.readFileSync(path.join(runsDir(rootDir), runId, file), 'utf8'));
      records.push(...(bundle.commands || []));
    } catch {
      // Not recorded yet.
    }
  }
  return records;
}

// [{ id, command, status: 'proven'|'failed'|'pending'|'unbound' }]
function acStatuses(goal, records) {
  return (goal?.acceptanceCriteria || []).map((criterion) => {
    const command = norm(criterion.verify?.command);
    if (!command) return { id: criterion.id, command: null, status: 'unbound' };
    const matches = (records || []).filter((record) => norm(record.command) === command);
    if (matches.some((record) => record.exitCode === 0 && record.timeoutStatus === 'COMPLETED')) {
      return { id: criterion.id, command, status: 'proven' };
    }
    return { id: criterion.id, command, status: matches.length ? 'failed' : 'pending' };
  });
}

function runAcStatuses(rootDir, run, goal) {
  return acStatuses(goal, recordedCommands(rootDir, run.runId));
}

// C-09 (learn-harness-engineering L09/L11): subjective ACs (UI, copy,
// design) carry a rubric. The ledger must score every criterion with
// evidence; an unscored or failed criterion blocks Judge PASS.
function rubricProblems(goal, ledger) {
  const problems = [];
  const scores = Array.isArray(ledger?.rubricScores) ? ledger.rubricScores : [];
  for (const criterion of goal?.acceptanceCriteria || []) {
    for (const item of Array.isArray(criterion.rubric) ? criterion.rubric : []) {
      const name = String(item.criterion || '').trim();
      const score = scores.find((entry) => entry.ac === criterion.id && String(entry.criterion || '').trim() === name);
      if (!score || typeof score.pass !== 'boolean' || !String(score.evidence || '').trim()) {
        problems.push(`${criterion.id} rubric "${name}" has no score with evidence in the Finding Ledger (rubricScores)`);
      } else if (!score.pass) {
        problems.push(`${criterion.id} rubric "${name}" failed: ${score.evidence}`);
      }
    }
  }
  return problems;
}

module.exports = { acStatuses, recordedCommands, rubricProblems, runAcStatuses };
