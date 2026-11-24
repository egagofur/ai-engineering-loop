'use strict';

const fs = require('fs');
const path = require('path');
const { loadRun, assertRunId } = require('../run-state.js');
const { loadWorkflow } = require('../workflow-runtime.js');
const { loadGoalDraft } = require('../goal-runtime.js');
const { renderHumanGoal } = require('../ste.js');
const { loadProvenance } = require('../provenance.js');
const { loadMerge, branchForRun } = require('../pr-status.js');
const { RECEIPT_FILE } = require('../receipt.js');
const { listRunInteractions, isFreezeQuestion } = require('../run-interactions.js');
const { runMaxIterations, readIterations } = require('../no-progress.js');
const { diagramOptions, flowCounts } = require('../flow.js');
const { renderDiagram } = require('../flow-diagram.js');
const { parseFreezeDiagramLine } = require('../generate-workflow.js');
const { contextPath } = require('./projects.js');

const STAGES = ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'];

const NODE_STAGE = {
  goal: 'goal',
  'goal-contract': 'goal',
  maker: 'maker',
  verification: 'verify',
  review: 'review',
  'devil-advocate': 'review',
  judge: 'judge',
  delivery: 'deliver',
  'delivery-approval': 'deliver'
};

const STATE_STAGE_INDEX = {
  STARTED: 0,
  GOAL_FROZEN: 1,
  REPORTED: 1,
  MAKER_COMPLETE: 2,
  VERIFIED: 3,
  REVIEWED: 4,
  JUDGED_PASS: 5,
  DELIVERED: 6
};

const FINISHED_STATES = new Set(['REPORTED', 'DELIVERED', 'CANCELLED', 'ESCALATED']);
const BLOCKING_SEVERITIES = new Set(['BLOCKER', 'HIGH']);
const LIVE_NODE_STATES = new Set(['READY', 'RUNNING']);

function walkScoped(root, parts, directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) contextPath(root, ...parts, entry.name);
    else if (entry.isDirectory()) walkScoped(root, [...parts, entry.name], path.join(directory, entry.name));
  }
}

function guardTree(root, parts) {
  walkScoped(root, parts, contextPath(root, ...parts));
}

function guardRoot(root) {
  contextPath(root, 'runs', 'current.json');
  contextPath(root, 'worktrees.json');
}

function runDirectory(root, runId) {
  assertRunId(runId);
  guardRoot(root);
  guardTree(root, ['runs', runId]);
  return contextPath(root, 'runs', runId);
}

function currentRunOf(root) {
  guardRoot(root);
  const pointer = contextPath(root, 'runs', 'current.json');
  if (!fs.existsSync(pointer)) return null;
  const { runId } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
  guardTree(root, ['runs', assertRunId(runId)]);
  return loadRun(root, runId);
}

function loadScopedRun(root, runId) {
  runDirectory(root, runId);
  return loadRun(root, runId);
}

function stageOfNode(node) {
  return NODE_STAGE[node.id] || NODE_STAGE[node.type] || null;
}

function ringFromWorkflow(workflow) {
  const byStage = new Map();
  const extraNodes = [];
  for (const node of workflow.plan.nodes || []) {
    const stage = stageOfNode(node);
    if (!stage) {
      extraNodes.push(node.id);
      continue;
    }
    const status = workflow.state.nodes[node.id]?.status;
    byStage.set(stage, [...(byStage.get(stage) || []), status]);
  }
  const statusOf = (statuses) => {
    if (!statuses) return 'skipped';
    if (statuses.every((s) => s === 'SKIPPED')) return 'skipped';
    if (statuses.every((s) => s === 'PASSED' || s === 'SKIPPED')) return 'done';
    if (statuses.some((s) => LIVE_NODE_STATES.has(s))) return 'now';
    return 'pending';
  };
  return { statuses: STAGES.map((stage) => statusOf(byStage.get(stage))), extraNodes };
}

function reachedIndex(run) {
  if (Object.hasOwn(STATE_STAGE_INDEX, run.state)) return { index: STATE_STAGE_INDEX[run.state], settled: false };
  const reached = (run.history || [])
    .map((entry) => STATE_STAGE_INDEX[entry.to])
    .filter((value) => Number.isInteger(value));
  return { index: Math.max(0, ...reached), settled: true };
}

function tierLabel(tier) {
  if (typeof tier === 'string') return tier || null;
  return tier && typeof tier.current === 'string' && tier.current ? tier.current : null;
}

function ringFromState(run) {
  if (run.state === 'REPORTED') {
    return { statuses: STAGES.map((stage) => (stage === 'goal' || stage === 'maker' ? 'done' : 'skipped')), extraNodes: [] };
  }
  const { index, settled } = reachedIndex(run);
  const skipped = tierLabel(run.tier) === 'T0' ? new Set(['review', 'judge']) : new Set();
  const statuses = STAGES.map((stage, position) => {
    if (skipped.has(stage)) return 'skipped';
    if (position < index) return 'done';
    if (position === index && !settled) return 'now';
    return 'pending';
  });
  if (!settled && index < STAGES.length && statuses[index] === 'skipped') {
    const next = statuses.findIndex((status, position) => position > index && status !== 'skipped');
    if (next !== -1) statuses[next] = 'now';
  }
  return { statuses, extraNodes: [] };
}

function readWorkflow(root, run) {
  if (!run.workflow) return null;
  try {
    return loadWorkflow(root, run.runId);
  } catch {
    return null;
  }
}

function pendingQuestions(root, runId) {
  try {
    return listRunInteractions(root, runId).pending;
  } catch {
    return [];
  }
}

function readDraft(root, runId) {
  try {
    return loadGoalDraft(root, runId);
  } catch {
    return null;
  }
}

function freezeDiagramPreference(root) {
  try {
    return parseFreezeDiagramLine(fs.readFileSync(contextPath(root, 'workflow.md'), 'utf8'));
  } catch (error) {
    if (error.code === 'PATH_OUTSIDE_SCOPE') return 'off';
    return 'auto';
  }
}

function goalSketch(root, draft) {
  const goal = draft && draft.contract;
  if (!goal || !Array.isArray(goal.flow) || !goal.flow.length) return null;
  const options = diagramOptions(goal, { preference: freezeDiagramPreference(root) });
  return options.length ? { options, counts: flowCounts(goal) } : null;
}

function waitingOf(root, run, workflow) {
  if (run.state === 'REPORTED') return null;
  const approval = workflow?.state.nodes['delivery-approval'];
  if (approval && approval.status === 'READY') {
    return { kind: 'approval', since: approval.updatedAt || run.updatedAt };
  }
  const draft = run.state === 'STARTED' ? readDraft(root, run.runId) : null;
  const goalHash = draft?.metadata.contentHash || null;
  const questions = pendingQuestions(root, run.runId);
  const question = goalHash ? questions.find((pending) => !isFreezeQuestion(pending)) : questions[0];
  if (question) return { kind: 'question', since: question.at || run.updatedAt };
  if (goalHash) return { kind: 'freeze', since: run.updatedAt, goalHash, sketch: Boolean(goalSketch(root, draft)) };
  return null;
}

function describeRun(root, run, now) {
  const workflow = readWorkflow(root, run);
  const { statuses, extraNodes } = workflow && run.state !== 'REPORTED' ? ringFromWorkflow(workflow) : ringFromState(run);
  const ring = STAGES.map((stage, position) => ({ stage, status: statuses[position] }));
  const current = ring.find((entry) => entry.status === 'now');
  const started = Date.parse(run.createdAt);
  return {
    summary: {
      runId: run.runId,
      task: run.task || '',
      state: run.state,
      tier: tierLabel(run.tier),
      iteration: run.iteration || 1,
      maxIterations: runMaxIterations(root, run),
      stage: current ? current.stage : null,
      ring,
      waiting: waitingOf(root, run, workflow),
      updatedAt: run.updatedAt,
      elapsedMs: Number.isFinite(started) ? Math.max(0, now - started) : 0
    },
    extraNodes
  };
}

function summarizeRun(root, loader, now) {
  try {
    const run = loader();
    return run ? describeRun(root, run, now).summary : null;
  } catch {
    return null;
  }
}

function worktreeRun(worktree, now) {
  const loader = worktree.runId
    ? () => loadScopedRun(worktree.path, worktree.runId)
    : () => currentRunOf(worktree.path);
  const summary = summarizeRun(worktree.path, loader, now);
  return summary && { ...summary, worktreeId: worktree.id };
}

function projectState(project, runs) {
  if (project.missing) return 'missing';
  if (runs.some((run) => run.waiting)) return 'waiting';
  if (runs.some((run) => !FINISHED_STATES.has(run.state))) return 'working';
  return 'idle';
}

function summarizeProject(project, { now = Date.now() } = {}) {
  if (project.missing) {
    return { id: project.id, name: project.name, state: 'missing', run: null, worktreeRuns: [] };
  }
  const run = summarizeRun(project.path, () => currentRunOf(project.path), now);
  const worktreeRuns = project.worktrees.map((worktree) => worktreeRun(worktree, now)).filter(Boolean);
  return {
    id: project.id,
    name: project.name,
    state: projectState(project, [...(run ? [run] : []), ...worktreeRuns]),
    run,
    worktreeRuns
  };
}

function readScopedJson(root, runId, file) {
  try {
    return JSON.parse(fs.readFileSync(contextPath(root, 'runs', runId, file), 'utf8'));
  } catch (error) {
    if (error.code === 'PATH_OUTSIDE_SCOPE') throw error;
    return null;
  }
}

function findingsOf(root, runId) {
  const ledger = readScopedJson(root, runId, 'findings.json');
  const list = Array.isArray(ledger) ? ledger : ledger && ledger.findings;
  if (!Array.isArray(list)) return null;
  return { total: list.length, blocking: list.filter((f) => f && BLOCKING_SEVERITIES.has(f.severity)).length };
}

function goalOf(root, runId) {
  try {
    const draft = loadGoalDraft(root, runId);
    if (!draft) return { markdown: null, hash: null };
    return {
      markdown: renderHumanGoal(draft.contract, { runId, revision: draft.metadata.revision || null }),
      hash: draft.metadata.contentHash || null
    };
  } catch {
    return { markdown: null, hash: null };
  }
}

function prOf(root, runId) {
  const branch = branchForRun(root, runId);
  const merge = loadMerge(root, runId);
  if (!branch && !merge) return null;
  return { branch: branch || (merge && merge.branch) || null, merged: Boolean(merge), url: (merge && merge.url) || null };
}

function receiptOf(root, runId) {
  return fs.existsSync(contextPath(root, 'runs', runId, RECEIPT_FILE)) ? 'written' : 'none';
}

function runDetail(target, runId, { now = Date.now() } = {}) {
  const root = target.root;
  const { summary, extraNodes } = describeRun(root, loadScopedRun(root, runId), now);
  const provenance = loadProvenance(root, runId);
  const goal = goalOf(root, runId);
  const sketch = summary.waiting && summary.waiting.kind === 'freeze' ? goalSketch(root, readDraft(root, runId)) : null;
  return {
    summary,
    goalMarkdown: goal.markdown,
    goalHash: goal.hash,
    findings: findingsOf(root, runId),
    pr: prOf(root, runId),
    receipt: receiptOf(root, runId),
    unconfirmed: provenance && Array.isArray(provenance.unconfirmed) ? provenance.unconfirmed : [],
    ...(sketch ? { diagramOptions: sketch.options, flowCounts: sketch.counts } : {}),
    extraNodes
  };
}

const HISTORY_LIMIT = 12;
const RUN_DIR_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function currentRunId(root) {
  try {
    return JSON.parse(fs.readFileSync(contextPath(root, 'runs', 'current.json'), 'utf8')).runId || null;
  } catch {
    return null;
  }
}

function lastVerdict(root, runId) {
  const entries = readIterations(root, runId);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index] && typeof entries[index].verdict === 'string') return entries[index].verdict;
  }
  return null;
}

function runHistory(target, { limit = HISTORY_LIMIT, now = Date.now() } = {}) {
  const root = target.root;
  guardRoot(root);
  let names;
  try {
    names = fs.readdirSync(contextPath(root, 'runs'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && RUN_DIR_NAME.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'PATH_OUTSIDE_SCOPE') throw error;
    return [];
  }
  const current = currentRunId(root);
  const runs = [];
  for (const runId of names.sort().reverse()) {
    if (runs.length >= limit) break;
    try {
      const run = loadScopedRun(root, runId);
      const started = Date.parse(run.createdAt);
      runs.push({
        runId,
        task: run.task || '',
        state: run.state,
        iteration: run.iteration || 1,
        verdict: lastVerdict(root, runId),
        current: runId === current,
        updatedAt: run.updatedAt || null,
        elapsedMs: Number.isFinite(started) ? Math.max(0, now - started) : 0
      });
    } catch (error) {
      if (error.code === 'PATH_OUTSIDE_SCOPE') throw error;
    }
  }
  return runs;
}

function goalDiagram(target, runId, view, { now = new Date() } = {}) {
  const root = target.root;
  loadScopedRun(root, runId);
  const draft = readDraft(root, runId);
  if (!draft) return { missing: 'No Goal draft for this Run' };
  if (!goalSketch(root, draft)) return { missing: 'This Goal draft has no flow to draw, or freeze diagrams are off' };
  return { html: renderDiagram(draft.contract, { view, revision: draft.metadata.revision ?? null, now }), hash: draft.metadata.contentHash || null };
}

module.exports = { STAGES, summarizeProject, runDetail, runHistory, goalDiagram };
