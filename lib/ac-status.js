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

module.exports = { acStatuses, recordedCommands, runAcStatuses };
