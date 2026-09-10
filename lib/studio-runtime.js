'use strict';

const { compileRecipe, loadRecipe } = require('./recipe.js');
const {
  RUN_MODES,
  TERMINAL_STATES,
  createRun,
  getCurrentRun,
  newRunId,
  normalizeRunMode
} = require('./run-state.js');
const { assertModeAllowed } = require('./runtime-policy.js');
const { createWorkflowBundle, startWorkflowExecution } = require('./workflow-runtime.js');

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
    throw studioRuntimeError(
      `Run ${current.runId} is already active; finish it before creating a sibling execution`,
      'ACTIVE_RUN'
    );
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

module.exports = { createStudioRun, executeStudioRun };
