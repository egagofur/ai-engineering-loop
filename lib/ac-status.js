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
// `verify` may name an exact `command`, a catalog `key` (C-23, e.g.
// "pentest"), or a `layer` (e.g. "LF"). Records carry `key`/`layer` when
// annotated by runAcStatuses.
function acStatuses(goal, records) {
  return (goal?.acceptanceCriteria || []).map((criterion) => {
    const verify = criterion.verify || {};
    const command = norm(verify.command);
    let label;
    let matches;
    if (command) {
      label = command;
      matches = (records || []).filter((record) => norm(record.command) === command);
    } else if (verify.key) {
      label = `key:${verify.key}`;
      matches = (records || []).filter((record) => record.key === verify.key);
    } else if (verify.layer) {
      label = `layer:${verify.layer}`;
      matches = (records || []).filter((record) => record.layer === verify.layer);
    } else {
      return { id: criterion.id, command: null, status: 'unbound' };
    }
    if (matches.some((record) => record.exitCode === 0 && record.timeoutStatus === 'COMPLETED')) {
      return { id: criterion.id, command: label, status: 'proven' };
    }
    return { id: criterion.id, command: label, status: matches.length ? 'failed' : 'pending' };
  });
}

function runAcStatuses(rootDir, run, goal) {
  const lanes = require('./verification-lanes.js');
  const records = recordedCommands(rootDir, run.runId).map((record) => {
    const key = record.key || lanes.keyOfCommand(rootDir, record.command);
    return { ...record, key, layer: record.layer || (key ? lanes.layerOfKey(key) : null) };
  });
  return acStatuses(goal, records);
}

// Catalog keys the frozen Goal's ACs require (C-23), so default verify runs them.
function requiredKeys(goal) {
  return [...new Set((goal?.acceptanceCriteria || []).map((criterion) => criterion.verify?.key).filter(Boolean))];
}

// Layers the frozen Goal's ACs require without naming a key (e.g. "LF").
function requiredLayers(goal) {
  return [...new Set((goal?.acceptanceCriteria || []).filter((criterion) => !criterion.verify?.key && !criterion.verify?.command)
    .map((criterion) => criterion.verify?.layer).filter(Boolean))];
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

module.exports = { acStatuses, recordedCommands, requiredKeys, requiredLayers, rubricProblems, runAcStatuses };
