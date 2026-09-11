'use strict';

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./recipe.js');
const { assertRunId, loadRun, runsDir } = require('./run-state.js');
const { redactSecrets } = require('./safe-context.js');

const MAX_EVENTS = 2000;
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const TYPES = new Set([
  'GOAL_DRAFTING',
  'GOAL_DRAFT_UPDATED',
  'GOAL_READY',
  'AGENT_HEARTBEAT',
  'AGENT_WAITING',
  'NODE_STARTED',
  'NODE_ACTIVITY',
  'NODE_COMPLETED',
  'LOOP_ITERATED',
  'RUN_COMPLETED'
]);
const ID = /^[A-Za-z0-9@._-]{1,64}$/;
const LOCK_STALE_MS = 60_000;

function lifecycleError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function lifecyclePath(rootDir, runId) {
  assertRunId(runId);
  loadRun(rootDir, runId);
  return path.join(runsDir(rootDir), runId, 'lifecycle.jsonl');
}

function materialHash(event) {
  const { hash, ...material } = event;
  return sha256(material);
}

function readLifecycle(rootDir, runId) {
  const file = lifecyclePath(rootDir, runId);
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > MAX_LEDGER_BYTES) {
    throw lifecycleError('Run lifecycle must be a bounded regular file', 'INVALID_RUN_LIFECYCLE');
  }
  const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  });
  let previousHash = null;
  for (const [index, event] of events.entries()) {
    if (!event || event.runId !== runId || event.sequence !== index + 1 ||
        event.previousHash !== previousHash || event.hash !== materialHash(event) ||
        !TYPES.has(event.type)) {
      throw lifecycleError(`Run lifecycle event ${index + 1} failed integrity validation`, 'INVALID_RUN_LIFECYCLE');
    }
    previousHash = event.hash;
  }
  return events;
}

function withLock(rootDir, runId, operation) {
  const lock = `${lifecyclePath(rootDir, runId)}.lock`;
  let descriptor;
  try {
    try {
      descriptor = fs.openSync(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = fs.lstatSync(lock);
      if (stat.isSymbolicLink() || !stat.isFile() || Date.now() - stat.mtimeMs <= LOCK_STALE_MS) {
        throw lifecycleError('Another lifecycle update is in progress', 'RUN_LIFECYCLE_BUSY');
      }
      fs.unlinkSync(lock);
      descriptor = fs.openSync(lock, 'wx', 0o600);
    }
    return operation();
  } finally {
    if (descriptor != null) {
      fs.closeSync(descriptor);
      try { fs.unlinkSync(lock); } catch {}
    }
  }
}

function appendRunLifecycle(rootDir, runId, event, { now = new Date() } = {}) {
  return withLock(rootDir, runId, () => {
    if (!TYPES.has(event?.type)) {
      throw lifecycleError('Lifecycle type is not allowed', 'INVALID_LIFECYCLE_TYPE');
    }
    const actor = String(event.actor || 'agent').trim();
    if (!ID.test(actor)) throw lifecycleError('Lifecycle actor is invalid', 'INVALID_LIFECYCLE_ACTOR');
    const phase = event.phase == null ? null : String(event.phase).trim();
    const nodeId = event.nodeId == null ? null : String(event.nodeId).trim();
    if ((phase && !ID.test(phase)) || (nodeId && !ID.test(nodeId))) {
      throw lifecycleError('Lifecycle phase or node is invalid', 'INVALID_LIFECYCLE_SCOPE');
    }
    const message = redactSecrets(String(event.message || '').trim()).text;
    if (!message || message.length > 240 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message)) {
      throw lifecycleError('Lifecycle message must be 1-240 printable characters', 'INVALID_LIFECYCLE_MESSAGE');
    }
    const events = readLifecycle(rootDir, runId);
    if (events.length >= MAX_EVENTS) {
      throw lifecycleError('Run lifecycle event limit reached', 'RUN_LIFECYCLE_LIMIT');
    }
    const material = {
      schemaVersion: 1,
      runId,
      sequence: events.length + 1,
      previousHash: events.at(-1)?.hash || null,
      at: now.toISOString(),
      type: event.type,
      actor,
      message,
      ...(phase ? { phase } : {}),
      ...(nodeId ? { nodeId } : {})
    };
    const result = { ...material, hash: sha256(material) };
    fs.appendFileSync(lifecyclePath(rootDir, runId), `${JSON.stringify(result)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'a'
    });
    return result;
  });
}

function listRunLifecycle(rootDir, runId, { after = 0, limit = 100 } = {}) {
  const cursor = Number(after);
  const pageSize = Number(limit);
  if (!Number.isSafeInteger(cursor) || cursor < 0 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw lifecycleError('Lifecycle cursor or limit is invalid', 'INVALID_LIFECYCLE_CURSOR');
  }
  const events = readLifecycle(rootDir, runId).filter((event) => event.sequence > cursor).slice(0, pageSize);
  return {
    runId,
    events,
    nextSequence: events.at(-1)?.sequence || cursor
  };
}

function runAgentPresence(rootDir, runId, { now = new Date() } = {}) {
  const events = readLifecycle(rootDir, runId);
  const last = events.findLast((event) => event.type === 'AGENT_HEARTBEAT');
  if (!last) return { status: 'UNKNOWN', lastHeartbeatAt: null };
  const ageMs = Math.max(0, now.getTime() - Date.parse(last.at));
  return {
    status: ageMs < 10_000 ? 'WORKING' : ageMs <= 30_000 ? 'IDLE' : 'DISCONNECTED',
    lastHeartbeatAt: last.at,
    ageMs
  };
}

module.exports = {
  MAX_EVENTS,
  appendRunLifecycle,
  listRunLifecycle,
  runAgentPresence
};
