'use strict';

const path = require('node:path');
const { compileRecipe } = require('../../lib/recipe.js');
const { resolveRunWorkflow } = require('../../lib/personal-workflow.js');
const { RUN_MODES, createRun, newRunId } = require('../../lib/run-state.js');
const { createWorkflowBundle } = require('../../lib/workflow-runtime.js');

function createWorkflowRun(root, { task, constraints = '', recipeId = null, mode = RUN_MODES.ASSISTED, now = new Date() } = {}) {
  const resolved = resolveRunWorkflow(root, { mode, recipeId: recipeId || null, home: path.join(root, '.test-home') });
  const plan = compileRecipe(resolved.recipe, { mode });
  const runId = newRunId(now);
  const workflow = createWorkflowBundle(plan, runId, {
    now,
    run: { runId, mode, state: 'STARTED', iteration: 1, task }
  });
  workflow.workflowSource = resolved.source;
  if (resolved.reason) workflow.workflowReason = resolved.reason;
  return createRun(root, { runId, task, mode, constraints, workflow, now });
}

module.exports = { createWorkflowRun };
