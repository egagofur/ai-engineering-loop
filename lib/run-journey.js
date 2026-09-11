'use strict';

const { loadGoalDraft } = require('./goal-runtime.js');
const { listRunInteractions } = require('./run-interactions.js');
const { readAllRunLifecycle } = require('./run-lifecycle.js');
const { loadRun } = require('./run-state.js');

const JOURNEY_STEPS = [
  'TASK_RECEIVED',
  'GOAL_DRAFTING',
  'WAITING_FOR_ANSWERS',
  'READY_FOR_GOAL_FREEZE',
  'WORKFLOW_EXECUTION',
  'RUN_COMPLETE'
];
const TERMINAL_STATES = new Set(['DELIVERED', 'REPORTED', 'ESCALATED', 'CANCELLED']);

function runJourney(rootDir, runId, { workflowState = null } = {}) {
  const run = loadRun(rootDir, runId);
  let draft = null;
  let draftAvailable = true;
  let interactions = { pending: [] };
  let interactionsAvailable = true;
  let lifecycle = [];
  let lifecycleAvailable = true;
  try {
    draft = loadGoalDraft(rootDir, runId);
  } catch {
    draftAvailable = false;
  }
  try {
    interactions = listRunInteractions(rootDir, runId);
  } catch {
    interactionsAvailable = false;
  }
  try {
    lifecycle = readAllRunLifecycle(rootDir, runId);
  } catch {
    lifecycleAvailable = false;
  }
  const workflowStarted = Object.values(workflowState?.nodes || {}).some((node) =>
    ['RUNNING', 'PASSED', 'FAILED', 'SKIPPED'].includes(node.status)
  ) || lifecycle.some((event) =>
    ['NODE_STARTED', 'NODE_ACTIVITY', 'NODE_COMPLETED', 'NODE_FAILED', 'LOOP_ITERATED'].includes(event.type)
  );
  const goalFrozen = run.goal?.frozen === true ||
    lifecycle.some((event) => event.type === 'GOAL_FROZEN');
  const complete = TERMINAL_STATES.has(run.state);
  let current = 'TASK_RECEIVED';
  if (draft || lifecycle.some((event) => event.type === 'GOAL_DRAFTING')) current = 'GOAL_DRAFTING';
  if (draft && interactionsAvailable && interactions.pending.length === 0) current = 'READY_FOR_GOAL_FREEZE';
  if (interactions.pending.length > 0 && !workflowStarted) current = 'WAITING_FOR_ANSWERS';
  if (goalFrozen || workflowStarted) current = 'WORKFLOW_EXECUTION';
  if (complete) current = 'RUN_COMPLETE';
  const currentIndex = JOURNEY_STEPS.indexOf(current);
  return {
    runId,
    current,
    blocked: interactionsAvailable ? interactions.pending.length > 0 : null,
    pendingQuestions: interactionsAvailable ? interactions.pending.length : null,
    degradedSources: [
      draftAvailable ? null : 'Goal draft',
      interactionsAvailable ? null : 'Agent Interaction',
      lifecycleAvailable ? null : 'Lifecycle activity'
    ].filter(Boolean),
    sources: { draftAvailable, interactionsAvailable, lifecycleAvailable },
    steps: JOURNEY_STEPS.map((id, index) => ({
      id,
      status: index < currentIndex ? 'COMPLETE' : (index === currentIndex ? 'ACTIVE' : 'PENDING'),
      ...(id === 'WAITING_FOR_ANSWERS' && interactions.pending.length > 0 ? { blocked: true } : {})
    }))
  };
}

module.exports = { JOURNEY_STEPS, runJourney };
