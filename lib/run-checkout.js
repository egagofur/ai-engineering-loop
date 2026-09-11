'use strict';

const { validateRecipe } = require('./recipe.js');
const { stableEdgeId } = require('./recipe-graph.js');
const { listRunInteractions } = require('./run-interactions.js');
const { loadRun } = require('./run-state.js');
const { inspectRunArtifact } = require('./run-history.js');
const { redactHomePaths, redactSecrets } = require('./safe-context.js');
const { workflowStatus } = require('./workflow-runtime.js');

function checkoutError(message, code = 'RUN_CHECKOUT_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fallbackPosition(index) {
  return { x: 100 + (index % 4) * 300, y: 100 + Math.floor(index / 4) * 190 };
}

function redactedValue(value) {
  const redactDeep = (item) => {
    if (typeof item === 'string') return redactHomePaths(item);
    if (Array.isArray(item)) return item.map(redactDeep);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, redactDeep(child)]));
    }
    return item;
  };
  return JSON.parse(redactSecrets(JSON.stringify(redactDeep(value))).text);
}

function edgeState(sourceStatus, targetStatus) {
  if (targetStatus === 'RUNNING') return 'active';
  if (targetStatus === 'FAILED') return 'failed';
  if (targetStatus === 'SKIPPED') return 'skipped';
  if (targetStatus === 'READY' || targetStatus === 'BLOCKED') return 'waiting';
  if (['PASSED', 'SKIPPED'].includes(sourceStatus) && targetStatus === 'PASSED') return 'passed';
  return 'idle';
}

function edgesFromPlan(plan, state = null) {
  return plan.nodes.flatMap((node) => (node.dependsOn || []).map((from) => {
    const sourceStatus = state?.nodes[from]?.status;
    const targetStatus = state?.nodes[node.id]?.status;
    const stateName = edgeState(sourceStatus, targetStatus);
    return {
      id: stableEdgeId(from, node.id),
      from,
      to: node.id,
      ...(state ? {
        state: stateName,
        traversed: !['idle', 'waiting'].includes(stateName),
        active: stateName === 'active'
      } : {})
    };
  }));
}

function publicNode(node, state, index) {
  const runtime = state.nodes[node.id] || {};
  return {
    id: node.id,
    displayName: node.displayName || node.name || node.id,
    type: node.type,
    status: runtime.status || 'PENDING',
    attempts: runtime.attempts || 0,
    reason: runtime.reason || null,
    loopGroupId: runtime.loopGroupId || null,
    loopIteration: runtime.loopIteration || null,
    updatedAt: runtime.updatedAt || null,
    position: fallbackPosition(index)
  };
}

function runCheckout(rootDir, runId) {
  const run = loadRun(rootDir, runId);
  const publicRun = {
    runId: run.runId,
    displayName: run.displayName,
    task: run.task,
    constraints: run.constraints || '',
    state: run.state,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
  if (!run.workflow) {
    return redactedValue({
      run: publicRun,
      graphHash: null,
      nodes: [],
      edges: [],
      loopGroups: [],
      workflowBound: false,
      readOnly: true
    });
  }
  const workflow = workflowStatus(rootDir, { runId });
  return redactedValue({
    run: publicRun,
    graphHash: workflow.plan.graphHash,
    nodes: workflow.plan.nodes.map((node, index) => publicNode(node, workflow.state, index)),
    edges: edgesFromPlan(workflow.plan, workflow.state),
    loopGroups: (workflow.plan.loopGroups || []).map((group) => ({
      ...group,
      runtime: workflow.state.loopGroups[group.id] || null
    })),
    workflowBound: true,
    readOnly: true
  });
}

function safeArtifact(rootDir, runId, artifact) {
  if (!artifact?.path) return null;
  try {
    return { descriptor: artifact, preview: inspectRunArtifact(rootDir, runId, artifact.path) };
  } catch (error) {
    return { descriptor: artifact, unavailable: true, code: error.code || 'HISTORY_ARTIFACT_UNAVAILABLE' };
  }
}

function runNodeIo(rootDir, runId, nodeId) {
  const run = loadRun(rootDir, runId);
  const workflow = workflowStatus(rootDir, { runId });
  const node = workflow.plan.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw checkoutError(`Node ${nodeId} is not part of Run ${runId}`, 'RUN_NODE_NOT_FOUND');
  const runtime = workflow.state.nodes[nodeId] || {};
  const upstream = (node.dependsOn || []).map((id) => {
    const upstreamState = workflow.state.nodes[id] || {};
    return {
      nodeId: id,
      status: upstreamState.status || 'PENDING',
      artifact: safeArtifact(rootDir, runId, upstreamState.artifact)
    };
  });
  const relevantEvents = workflow.events.filter((event) =>
    event.nodeId === nodeId ||
    event.type === 'WORKFLOW_CREATED' ||
    (event.changes || []).some((change) => change.nodeId === nodeId)
  ).map(({ initialNodes, ...event }) => event);
  const finishedIndex = relevantEvents.findLastIndex((event) =>
    ['NODE_COMPLETED', 'NODE_FAILED'].includes(event.type)
  );
  const finished = relevantEvents[finishedIndex];
  const started = finishedIndex < 0
    ? null
    : relevantEvents.slice(0, finishedIndex).findLast((event) => event.type === 'NODE_STARTED');
  const durationMs = runtime.status !== 'RUNNING' &&
    started && finished && Date.parse(finished.at) >= Date.parse(started.at)
    ? Date.parse(finished.at) - Date.parse(started.at)
    : null;
  let agentInteractions = [];
  let agentInteractionsAvailable = true;
  try {
    agentInteractions = listRunInteractions(rootDir, runId).interactions.slice(-50);
  } catch {
    agentInteractionsAvailable = false;
  }
  return redactedValue({
    runId,
    node: publicNode(node, workflow.state, workflow.plan.nodes.indexOf(node)),
    durationMs,
    loopIteration: runtime.loopIteration || null,
    agentInteractionScope: 'RUN',
    agentInteractionsAvailable,
    agentInteractions,
    input: {
      task: node.dependsOn?.length ? null : run.task,
      constraints: node.dependsOn?.length ? null : (run.constraints || ''),
      goal: node.dependsOn?.length ? null : (run.goal || null),
      dependencies: upstream
    },
    output: {
      status: runtime.status || 'PENDING',
      reason: runtime.reason || null,
      loopGroupId: runtime.loopGroupId || null,
      loopIteration: runtime.loopIteration || null,
      artifact: safeArtifact(rootDir, runId, runtime.artifact)
    },
    evidence: safeArtifact(rootDir, runId, runtime.artifact),
    timeline: relevantEvents
  });
}

function authoringNode(node) {
  const omitted = new Set(['dependsOn', 'order', 'legacyGate', 'capabilities', 'status']);
  return Object.fromEntries(Object.entries(node).filter(([key]) => !omitted.has(key)));
}

function duplicateRunAsRecipe(rootDir, runId, { recipeId } = {}) {
  const workflow = workflowStatus(rootDir, { runId });
  const id = String(recipeId || `${workflow.plan.recipe.id || 'workflow'}-copy`).trim();
  const recipe = {
    schemaVersion: 1,
    id,
    name: `${workflow.plan.recipe.name || workflow.plan.recipe.id || 'Workflow'} copy`,
    description: 'Created from an immutable Run plan.',
    version: 1,
    compatibleModes: [workflow.plan.mode],
    nodes: workflow.plan.nodes.map(authoringNode),
    edges: edgesFromPlan(workflow.plan),
    loopGroups: workflow.plan.loopGroups || []
  };
  const validation = validateRecipe(recipe);
  if (!validation.valid) {
    throw checkoutError(`Run cannot be duplicated: ${validation.errors.join('; ')}`, 'INVALID_RUN_DUPLICATE');
  }
  return { sourceRunId: runId, recipe, validation, installed: false };
}

function studioAgentHandoff(rootDir, runId) {
  const run = loadRun(rootDir, runId);
  const commandRoot = `npx ai-engineering-loop interaction`;
  const lifecycleCommand = `npx ai-engineering-loop activity heartbeat --run ${runId} --phase <phase> --message "<factual update>"`;
  const goalCommand = `npx ai-engineering-loop goal draft --run ${runId} --file <repository-relative-goal.json> --revision <current-revision>`;
  return redactedValue({
    runId,
    externalDispatch: false,
    prompt: [
      `Continue AI Engineering Loop Run ${runId}.`,
      `Task: ${run.task}`,
      run.constraints ? `Constraints: ${run.constraints}` : null,
      'From the repository root, read the Run state and evidence before acting.',
      `Draft the Goal through the Run-scoped bridge with: ${goalCommand}`,
      `Report persisted lifecycle progress with: ${lifecycleCommand}`,
      `When blocked, ask with: ${commandRoot} question --run ${runId} --message "Your question"`,
      `Poll answers with: ${commandRoot} list --run ${runId} --json`,
      'Do not create a sibling Run or claim completion without Run-bound evidence.'
    ].filter(Boolean).join('\n'),
    commands: {
      inspect: `npx ai-engineering-loop status --run ${runId}`,
      goalDraft: goalCommand,
      lifecycle: lifecycleCommand,
      question: `${commandRoot} question --run ${runId} --message "Your question"`,
      answers: `${commandRoot} list --run ${runId} --json`
    }
  });
}

module.exports = {
  duplicateRunAsRecipe,
  edgeState,
  edgesFromPlan,
  redactedValue,
  runCheckout,
  runNodeIo,
  studioAgentHandoff
};
