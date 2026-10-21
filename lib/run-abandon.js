'use strict';

// `run --abandon` (issue #46): close a run that will never finish so it stops
// holding `refresh --non-destructive` and `update auto` back. The run moves to
// CANCELLED with reason, actor, and time in its history ledger (workflow runs
// also get a RUN_CANCELLED event in events.jsonl). Run data is never deleted.
// The current.json pointer is released only when it pointed at that run.

const fs = require('fs');
const { ACTOR_ID } = require('./fsutil.js');
const {
  RUN_STATES,
  TERMINAL_STATES,
  assertRunId,
  atomicWriteJson,
  currentRunPath,
  loadRun,
  transitionRun
} = require('./run-state.js');
const { redactSecrets } = require('./safe-context.js');

const STALE_RUN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function abandonError(message, code, exitCode = 1) {
  const err = new Error(message);
  err.code = code;
  err.exitCode = exitCode;
  return err;
}

function currentPointerRunId(rootDir) {
  try {
    const { runId } = JSON.parse(fs.readFileSync(currentRunPath(rootDir), 'utf8'));
    return assertRunId(runId);
  } catch {
    return null;
  }
}

// { stale, idleDays } for an active run; terminal runs are never stale.
function staleRunInfo(run, { now = new Date(), days = STALE_RUN_DAYS } = {}) {
  if (!run || TERMINAL_STATES.has(run.state)) return { stale: false, idleDays: 0 };
  const last = Date.parse(run.updatedAt || run.createdAt);
  if (!Number.isFinite(last)) return { stale: false, idleDays: 0 };
  const idleDays = Math.floor((now.getTime() - last) / DAY_MS);
  return { stale: idleDays >= days, idleDays };
}

function abandonCommand(runId) {
  return `ai-engineering-loop run --abandon${runId ? ` --run ${runId}` : ''} --reason "<why>" --by <name>`;
}

// Validates everything before writing anything.
function planAbandon(rootDir, { runId = null, reason, by } = {}) {
  const pointer = currentPointerRunId(rootDir);
  const target = runId || pointer;
  if (!target) {
    throw abandonError('No current run to abandon. Pass --run <id> (see `ai-engineering-loop history`).', 'NO_ACTIVE_RUN', 2);
  }
  const run = loadRun(rootDir, assertRunId(target));
  if (TERMINAL_STATES.has(run.state)) {
    throw abandonError(`Run ${run.runId} is already finished (${run.state}); nothing to abandon.`, 'RUN_ALREADY_FINISHED', 2);
  }
  const actor = String(by || '').trim();
  if (!ACTOR_ID.test(actor)) {
    throw abandonError('--by <name> is required (letters, digits, @._-; max 64).', 'INVALID_RUN_ACTOR');
  }
  const cleanReason = redactSecrets(String(reason || '').trim()).text;
  if (!cleanReason || cleanReason.length > 500) {
    throw abandonError('--reason "<text>" is required (1-500 characters).', 'INVALID_ABANDON_REASON');
  }
  return { run, pointer, actor, reason: cleanReason };
}

function abandonRun(rootDir, { runId = null, reason, by, now = new Date() } = {}) {
  const plan = planAbandon(rootDir, { runId, reason, by });
  const { run, pointer, actor } = plan;
  const fromState = run.state;
  let next;
  if (run.workflow) {
    next = require('./workflow-runtime.js').cancelWorkflowRun(rootDir, {
      runId: run.runId,
      actor,
      reason: `Abandoned: ${plan.reason}`,
      now
    }).run;
  } else {
    next = transitionRun(rootDir, run.runId, RUN_STATES.CANCELLED, {
      gate: 'run-abandoned',
      reason: plan.reason,
      historyMetadata: { actor, action: 'abandon' },
      now
    });
  }
  // transitionRun rewrote current.json to this run. Release it, or put back
  // the pointer to the other run that was current before.
  let released = false;
  if (pointer && pointer !== run.runId) {
    atomicWriteJson(currentRunPath(rootDir), { schemaVersion: 1, runId: pointer });
  } else {
    fs.rmSync(currentRunPath(rootDir), { force: true });
    released = Boolean(pointer);
  }
  return {
    runId: run.runId,
    from: fromState,
    state: next.state,
    reason: plan.reason,
    by: actor,
    at: now.toISOString(),
    released,
    current: pointer && pointer !== run.runId ? pointer : null
  };
}

module.exports = { STALE_RUN_DAYS, staleRunInfo, abandonCommand, planAbandon, abandonRun, currentPointerRunId };
