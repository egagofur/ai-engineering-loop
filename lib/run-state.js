'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RUN_STATES = Object.freeze({
  STARTED: 'STARTED',
  GOAL_FROZEN: 'GOAL_FROZEN',
  MAKER_COMPLETE: 'MAKER_COMPLETE',
  VERIFIED: 'VERIFIED',
  REVIEWED: 'REVIEWED',
  JUDGED_PASS: 'JUDGED_PASS',
  DELIVERED: 'DELIVERED',
  ESCALATED: 'ESCALATED'
});

const ALLOWED_TRANSITIONS = Object.freeze({
  STARTED: ['GOAL_FROZEN'],
  GOAL_FROZEN: ['MAKER_COMPLETE'],
  MAKER_COMPLETE: ['VERIFIED'],
  VERIFIED: ['REVIEWED'],
  REVIEWED: ['GOAL_FROZEN', 'JUDGED_PASS', 'ESCALATED'],
  JUDGED_PASS: ['DELIVERED'],
  DELIVERED: [],
  ESCALATED: []
});

const TERMINAL_STATES = new Set([RUN_STATES.DELIVERED, RUN_STATES.ESCALATED]);

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

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
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

function runStatePath(rootDir, runId) {
  return path.join(runsDir(rootDir), assertRunId(runId), 'state.json');
}

function currentRunPath(rootDir) {
  return path.join(runsDir(rootDir), 'current.json');
}

function loadRun(rootDir, runId) {
  const state = readJson(runStatePath(rootDir, runId), `run ${runId}`);
  if (state.runId !== runId || !RUN_STATES[state.state]) {
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

function createRun(rootDir, { task = '', runId = newRunId(), now = new Date() } = {}) {
  assertRunId(runId);
  const statePath = runStatePath(rootDir, runId);
  if (fs.existsSync(statePath)) {
    const err = new Error(`Run already exists: ${runId}`);
    err.code = 'RUN_EXISTS';
    throw err;
  }

  const timestamp = now.toISOString();
  const state = {
    schemaVersion: 1,
    runId,
    state: RUN_STATES.STARTED,
    iteration: 1,
    task: String(task || '').trim(),
    startedRevision: getGitRevision(rootDir),
    createdAt: timestamp,
    updatedAt: timestamp,
    artifacts: {},
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

function createOrResumeRun(rootDir, { task = '', forceNew = false, now = new Date() } = {}) {
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
    return { run: current, resumed: true };
  }
  return { run: createRun(rootDir, { task: requestedTask, now }), resumed: false };
}

function transitionRun(
  rootDir,
  runId,
  to,
  { gate, artifacts = {}, reason = null, incrementIteration = false, now = new Date() } = {}
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
        ...(reason ? { reason } : {})
      }
    ]
  };
  atomicWriteJson(runStatePath(rootDir, runId), next);
  atomicWriteJson(currentRunPath(rootDir), { schemaVersion: 1, runId });
  return next;
}

module.exports = {
  RUN_STATES,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATES,
  runsDir,
  runStatePath,
  currentRunPath,
  atomicWriteJson,
  getGitRevision,
  newRunId,
  loadRun,
  getCurrentRun,
  createRun,
  createOrResumeRun,
  transitionRun
};
