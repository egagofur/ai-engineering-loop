'use strict';

const { compileRecipe, loadRecipe } = require('./recipe.js');
const {
  RUN_MODES,
  TERMINAL_STATES,
  createRun,
  getCurrentRun,
  loadRun,
  newRunId,
  normalizeRunMode,
  transitionRun
} = require('./run-state.js');
const { assertModeAllowed } = require('./runtime-policy.js');
const {
  cancelWorkflowRun,
  createWorkflowBundle,
  startWorkflowExecution
} = require('./workflow-runtime.js');

function studioRuntimeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createStudioRun(
  rootDir,
  {
    task,
    constraints = '',
    recipeId,
    mode = RUN_MODES.ASSISTED,
    displayName = '',
    now = new Date()
  } = {}
) {
  const normalizedTask = String(task || '').trim();
  if (!normalizedTask || normalizedTask.length > 2000) {
    throw studioRuntimeError('Task must be 1-2000 characters', 'INVALID_RUN_TASK');
  }
  const normalizedMode = normalizeRunMode(mode);
  assertModeAllowed(rootDir, normalizedMode);
  const current = getCurrentRun(rootDir);
  if (current && !TERMINAL_STATES.has(current.state)) {
    const error = studioRuntimeError(
      `Run ${current.runId} is already active; finish it before creating a sibling execution`,
      'ACTIVE_RUN'
    );
    error.activeRun = {
      runId: current.runId,
      displayName: current.displayName,
      task: current.task,
      state: current.state,
      updatedAt: current.updatedAt
    };
    throw error;
  }
  const loaded = loadRecipe(rootDir, recipeId);
  const plan = compileRecipe(loaded.recipe, { mode: normalizedMode });
  const runId = newRunId(now);
  const workflow = createWorkflowBundle(plan, runId, {
    now,
    run: {
      runId,
      mode: normalizedMode,
      state: 'STARTED',
      iteration: 1,
      task: normalizedTask
    }
  });
  return createRun(rootDir, {
    runId,
    task: normalizedTask,
    mode: normalizedMode,
    displayName,
    constraints,
    workflow,
    now
  });
}

function executeStudioRun(rootDir, runId, { now = new Date() } = {}) {
  return startWorkflowExecution(rootDir, { runId, now });
}

function cancelStudioRun(
  rootDir,
  runId,
  { actor = 'human', reason = 'Replaced by a new Goal', now = new Date() } = {}
) {
  const run = loadRun(rootDir, runId);
  if (TERMINAL_STATES.has(run.state)) {
    throw studioRuntimeError(`Run ${runId} is already finished`, 'RUN_ALREADY_FINISHED');
  }
  const cleanActor = String(actor || '').trim();
  const cleanReason = String(reason || '').trim();
  if (!/^[A-Za-z0-9@._-]{1,64}$/.test(cleanActor)) {
    throw studioRuntimeError('Cancellation actor must be a short account identifier', 'INVALID_RUN_ACTOR');
  }
  if (!cleanReason || cleanReason.length > 500) {
    throw studioRuntimeError('Cancellation reason must be 1-500 characters', 'INVALID_CANCEL_REASON');
  }
  if (run.workflow) {
    return cancelWorkflowRun(rootDir, {
      runId,
      actor: cleanActor,
      reason: cleanReason,
      now
    }).run;
  }
  return transitionRun(rootDir, runId, 'CANCELLED', {
    gate: 'run-cancelled',
    reason: cleanReason,
    historyMetadata: { actor: cleanActor },
    now
  });
}

module.exports = { cancelStudioRun, createStudioRun, executeStudioRun };
