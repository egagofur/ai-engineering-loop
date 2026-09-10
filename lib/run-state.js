'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RUN_STATES = Object.freeze({
  STARTED: 'STARTED',
  GOAL_FROZEN: 'GOAL_FROZEN',
  REPORTED: 'REPORTED',
  MAKER_COMPLETE: 'MAKER_COMPLETE',
  VERIFIED: 'VERIFIED',
  REVIEWED: 'REVIEWED',
  JUDGED_PASS: 'JUDGED_PASS',
  DELIVERED: 'DELIVERED',
  ESCALATED: 'ESCALATED',
  CANCELLED: 'CANCELLED'
});

const RUN_MODES = Object.freeze({
  REPORT_ONLY: 'REPORT_ONLY',
  ASSISTED: 'ASSISTED',
  UNATTENDED: 'UNATTENDED'
});

const ALLOWED_TRANSITIONS = Object.freeze({
  STARTED: ['GOAL_FROZEN', 'CANCELLED'],
  GOAL_FROZEN: ['STARTED', 'REPORTED', 'MAKER_COMPLETE', 'CANCELLED'],
  REPORTED: [],
  MAKER_COMPLETE: ['VERIFIED', 'CANCELLED'],
  VERIFIED: ['REVIEWED', 'CANCELLED'],
  REVIEWED: ['GOAL_FROZEN', 'JUDGED_PASS', 'ESCALATED', 'CANCELLED'],
  JUDGED_PASS: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  ESCALATED: [],
  CANCELLED: []
});

const TERMINAL_STATES = new Set([
  RUN_STATES.REPORTED,
  RUN_STATES.DELIVERED,
  RUN_STATES.ESCALATED,
  RUN_STATES.CANCELLED
]);

function runsDir(rootDir) {
  return path.join(rootDir, '.ai-engineering-loop', 'runs');
}

function assertRunId(runId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(String(runId || ''))) {
    const err = new Error(`Invalid run id: ${runId || '(empty)'}`);
    err.code = 'INVALID_RUN_ID';
    throw err;
  }
  return runId;
}

function atomicWritePrivateFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Rename succeeded or no temporary file was written.
    }
  }
}

function atomicWriteJson(filePath, value) {
  atomicWritePrivateFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    const err = new Error(`Unable to read ${label}: ${cause.message}`);
    err.code = 'INVALID_RUN_STATE';
    err.cause = cause;
    throw err;
  }
}

function getGitRevision(rootDir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return 'untracked';
  }
}

function newRunId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function runDisplayMetadata(task, displayName) {
  const normalizedTask = String(task || '').trim().replace(/\s+/g, ' ');
  const safeProposal = String(displayName || '').trim().replace(/\s+/g, ' ');
  const usableProposal = safeProposal &&
    safeProposal.length <= 100 &&
    !/[\u0000-\u001f/\\]/.test(safeProposal);
  const fallbackWords = normalizedTask
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7);
  const fallback = fallbackWords.join(' ') || 'Untitled run';
  const name = usableProposal ? safeProposal : fallback;
  const slug = name.toLocaleLowerCase('en-US')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled-run';
  const keywords = [...new Set(
    normalizedTask.toLocaleLowerCase('en-US')
      .match(/[\p{L}\p{N}]{2,}/gu) || []
  )].slice(0, 20);
  return { displayName: name, slug, keywords };
}

function runStatePath(rootDir, runId) {
  return path.join(runsDir(rootDir), assertRunId(runId), 'state.json');
}

function currentRunPath(rootDir) {
  return path.join(runsDir(rootDir), 'current.json');
}

function writeWorkflowBundle(rootDir, runId, workflow) {
  if (!workflow) return null;
  const directory = path.join(runsDir(rootDir), runId);
  const { plan, state, events } = workflow;
  if (
    !plan?.graphHash ||
    state?.graphHash !== plan.graphHash ||
    !Array.isArray(events) ||
    events.length === 0
  ) {
    const err = new Error('Workflow bundle is invalid');
    err.code = 'INVALID_WORKFLOW_BUNDLE';
    throw err;
  }
  atomicWriteJson(path.join(directory, 'plan.json'), plan);
  atomicWriteJson(path.join(directory, 'workflow-state.json'), state);
  atomicWritePrivateFile(
    path.join(directory, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`
  );
  return {
    recipeId: plan.recipe.id,
    recipeVersion: plan.recipe.version,
    sourceHash: plan.recipe.sourceHash,
    graphHash: plan.graphHash
  };
}

function loadRun(rootDir, runId) {
  const state = readJson(runStatePath(rootDir, runId), `run ${runId}`);
  if (
    state.runId !== runId ||
    !RUN_STATES[state.state] ||
    (state.mode != null && !Object.values(RUN_MODES).includes(state.mode))
  ) {
    const err = new Error(`Run ${runId} has an invalid state document`);
    err.code = 'INVALID_RUN_STATE';
    throw err;
  }
  return state;
}

function getCurrentRun(rootDir) {
  const pointer = currentRunPath(rootDir);
  if (!fs.existsSync(pointer)) return null;
  const { runId } = readJson(pointer, 'current run pointer');
  return loadRun(rootDir, assertRunId(runId));
}

function normalizeRunMode(mode) {
  const normalized = String(mode || RUN_MODES.ASSISTED).trim().replace(/-/g, '_').toUpperCase();
  if (!Object.hasOwn(RUN_MODES, normalized)) {
    const err = new Error(`Invalid run mode: ${mode}`);
    err.code = 'INVALID_RUN_MODE';
    throw err;
  }
  return RUN_MODES[normalized];
}

function createRun(
  rootDir,
  {
    task = '',
    runId = newRunId(),
    mode = RUN_MODES.ASSISTED,
    now = new Date(),
    workflow = null,
    displayName = '',
    constraints = ''
  } = {}
) {
  assertRunId(runId);
  const statePath = runStatePath(rootDir, runId);
  if (fs.existsSync(statePath)) {
    const err = new Error(`Run already exists: ${runId}`);
    err.code = 'RUN_EXISTS';
    throw err;
  }

  const timestamp = now.toISOString();
  const normalizedTask = String(task || '').trim();
  const normalizedConstraints = String(constraints || '').trim();
  if (normalizedConstraints.length > 8000) {
    const err = new Error('Run constraints must not exceed 8000 characters');
    err.code = 'INVALID_RUN_CONSTRAINTS';
    throw err;
  }
  const presentation = runDisplayMetadata(normalizedTask, displayName);
  const workflowMetadata = writeWorkflowBundle(rootDir, runId, workflow);
  const state = {
    schemaVersion: 1,
    runId,
    state: RUN_STATES.STARTED,
    mode: normalizeRunMode(mode),
    iteration: 1,
    task: normalizedTask,
    constraints: normalizedConstraints,
    ...presentation,
    startedRevision: getGitRevision(rootDir),
    createdAt: timestamp,
    updatedAt: timestamp,
    artifacts: {},
    ...(workflowMetadata ? { workflow: workflowMetadata } : {}),
    history: [
      {
        from: null,
        to: RUN_STATES.STARTED,
        gate: 'start',
        at: timestamp
      }
    ]
  };

  atomicWriteJson(statePath, state);
  atomicWriteJson(currentRunPath(rootDir), { schemaVersion: 1, runId });
  return state;
}

function createOrResumeRun(
  rootDir,
  { task = '', runId, mode = null, forceNew = false, now = new Date(), workflow = null } = {}
) {
  const current = getCurrentRun(rootDir);
  const requestedTask = String(task || '').trim();
  if (current && !TERMINAL_STATES.has(current.state) && !forceNew) {
    if (requestedTask && current.task && requestedTask !== current.task) {
      const err = new Error(
        `Run ${current.runId} is still ${current.state}. Resume it or pass --new to start another task.`
      );
      err.code = 'ACTIVE_RUN';
      throw err;
    }
    if (mode && normalizeRunMode(mode) !== (current.mode || RUN_MODES.ASSISTED)) {
      const err = new Error(`Run ${current.runId} is already ${(current.mode || RUN_MODES.ASSISTED)}; mode cannot change during a run.`);
      err.code = 'RUN_MODE_MISMATCH';
      throw err;
    }
    if (workflow && current.workflow?.graphHash !== workflow.plan.graphHash) {
      const err = new Error(`Run ${current.runId} is bound to a different workflow graph.`);
      err.code = 'RUN_WORKFLOW_MISMATCH';
      throw err;
    }
    return { run: current, resumed: true };
  }
  return {
    run: createRun(rootDir, {
      task: requestedTask,
      ...(runId ? { runId } : {}),
      mode: mode || RUN_MODES.ASSISTED,
      now,
      workflow
    }),
    resumed: false
  };
}

function updateRunDisplayName(rootDir, runId, displayName, { actor = 'human', now = new Date() } = {}) {
  const run = loadRun(rootDir, runId);
  const proposed = String(displayName || '').trim().replace(/\s+/g, ' ');
  if (!proposed || proposed.length > 100 || /[\u0000-\u001f/\\]/.test(proposed)) {
    const err = new Error('Display Name must be 1-100 characters without control characters or path separators');
    err.code = 'INVALID_RUN_DISPLAY_NAME';
    throw err;
  }
  if (!/^[A-Za-z0-9@._-]{1,64}$/.test(String(actor))) {
    const err = new Error('Display Name actor must be a short account identifier');
    err.code = 'INVALID_RUN_ACTOR';
    throw err;
  }
  const timestamp = now.toISOString();
  const presentation = runDisplayMetadata(run.task, proposed);
  const next = {
    ...run,
    ...presentation,
    runId: run.runId,
    updatedAt: timestamp,
    history: [
      ...(run.history || []),
      {
        from: run.state,
        to: run.state,
        gate: 'run-metadata',
        at: timestamp,
        actor: String(actor),
        displayName: presentation.displayName
      }
    ]
  };
  atomicWriteJson(runStatePath(rootDir, runId), next);
  return next;
}

function transitionRun(
  rootDir,
  runId,
  to,
  {
    gate,
    artifacts = {},
    reason = null,
    incrementIteration = false,
    statePatch = {},
    historyMetadata = {},
    now = new Date()
  } = {}
) {
  const run = loadRun(rootDir, runId);
  if (!RUN_STATES[to]) {
    const err = new Error(`Unknown run state: ${to}`);
    err.code = 'UNKNOWN_RUN_STATE';
    throw err;
  }
  if (!ALLOWED_TRANSITIONS[run.state].includes(to)) {
    const err = new Error(`Invalid transition: ${run.state} -> ${to}`);
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  const timestamp = now.toISOString();
  const next = {
    ...run,
    ...statePatch,
    runId: run.runId,
    state: to,
    iteration: incrementIteration ? run.iteration + 1 : run.iteration,
    updatedAt: timestamp,
    artifacts: { ...run.artifacts, ...artifacts },
    history: [
      ...run.history,
      {
        from: run.state,
        to,
        gate: gate || 'unspecified',
        at: timestamp,
        ...(reason ? { reason } : {}),
        ...historyMetadata
      }
    ]
  };
  atomicWriteJson(runStatePath(rootDir, runId), next);
  atomicWriteJson(currentRunPath(rootDir), { schemaVersion: 1, runId });
  return next;
}

module.exports = {
  RUN_STATES,
  RUN_MODES,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATES,
  runsDir,
  assertRunId,
  runStatePath,
  currentRunPath,
  atomicWritePrivateFile,
  atomicWriteJson,
  getGitRevision,
  newRunId,
  runDisplayMetadata,
  normalizeRunMode,
  loadRun,
  getCurrentRun,
  createRun,
  createOrResumeRun,
  updateRunDisplayName,
  transitionRun
};
