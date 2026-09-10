'use strict';

const { validateRecipe } = require('./recipe.js');
const { stableEdgeId } = require('./recipe-graph.js');
const { loadRun } = require('./run-state.js');
const { inspectRunArtifact } = require('./run-history.js');
const { redactSecrets } = require('./safe-context.js');
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
  return JSON.parse(redactSecrets(JSON.stringify(value)).text);
}

function edgesFromPlan(plan) {
  return plan.nodes.flatMap((node) => (node.dependsOn || []).map((from) => ({
    id: stableEdgeId(from, node.id),
    from,
    to: node.id
  })));
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
  const workflow = workflowStatus(rootDir, { runId });
  return redactedValue({
    run: {
      runId: run.runId,
      displayName: run.displayName,
      task: run.task,
      constraints: run.constraints || '',
      state: run.state,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt
    },
    graphHash: workflow.plan.graphHash,
    nodes: workflow.plan.nodes.map((node, index) => publicNode(node, workflow.state, index)),
    edges: edgesFromPlan(workflow.plan),
    loopGroups: (workflow.plan.loopGroups || []).map((group) => ({
      ...group,
      runtime: workflow.state.loopGroups[group.id] || null
    })),
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
  return redactedValue({
    runId,
    node: publicNode(node, workflow.state, workflow.plan.nodes.indexOf(node)),
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
  return redactedValue({
    runId,
    externalDispatch: false,
    prompt: [
      `Continue AI Engineering Loop Run ${runId}.`,
      `Task: ${run.task}`,
      run.constraints ? `Constraints: ${run.constraints}` : null,
      'Read the Run state and evidence before acting.',
      `When blocked, ask with: ${commandRoot} question --run ${runId} --message "Your question"`,
      `Poll answers with: ${commandRoot} list --run ${runId} --json`,
      'Do not create a sibling Run or claim completion without Run-bound evidence.'
    ].filter(Boolean).join('\n'),
    commands: {
      inspect: `npx ai-engineering-loop status --run ${runId}`,
      question: `${commandRoot} question --run ${runId} --message "Your question"`,
      answers: `${commandRoot} list --run ${runId} --json`
    }
  });
}

module.exports = {
  duplicateRunAsRecipe,
  runCheckout,
  runNodeIo,
  studioAgentHandoff
};
