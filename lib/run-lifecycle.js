'use strict';

const path = require('path');
const { ACTOR_ID } = require('./fsutil.js');
const { createLedger } = require('./jsonl-ledger.js');
const { loadRun } = require('./run-state.js');
const { redactSecrets } = require('./safe-context.js');

const MAX_EVENTS = 2000;
const MAX_LEDGER_BYTES = 4 * 1024 * 1024;
const TYPES = new Set([
  'GOAL_DRAFTING',
  'GOAL_DRAFT_UPDATED',
  'GOAL_READY',
  'GOAL_FROZEN',
  'PHASE_COMPLETED',
  'AGENT_HEARTBEAT',
  'AGENT_WAITING',
  'NODE_STARTED',
  'NODE_ACTIVITY',
  'NODE_COMPLETED',
  'NODE_FAILED',
  'LOOP_ITERATED',
  'RUN_COMPLETED'
]);
const NODE_TYPES = new Set(['NODE_STARTED', 'NODE_ACTIVITY', 'NODE_COMPLETED', 'NODE_FAILED']);
const STATUSES = new Set(['WORKING', 'WAITING', 'PASSED', 'FAILED', 'SKIPPED', 'UNKNOWN']);

function lifecycleError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const ledger = createLedger({
  fileName: 'lifecycle.jsonl',
  maxBytes: MAX_LEDGER_BYTES,
  types: TYPES,
  codes: { invalid: 'INVALID_RUN_LIFECYCLE', busy: 'RUN_LIFECYCLE_BUSY' },
  messages: {
    bounded: 'Run lifecycle must be a bounded regular file',
    event: 'Run lifecycle event',
    busy: 'Another lifecycle update is in progress'
  }
});

function readLifecycle(rootDir, runId) {
  return ledger.read(rootDir, runId);
}

function appendRunLifecycle(rootDir, runId, event, { now = new Date() } = {}) {
  return ledger.withLock(rootDir, runId, () => {
    if (!TYPES.has(event?.type)) {
      throw lifecycleError('Lifecycle type is not allowed', 'INVALID_LIFECYCLE_TYPE');
    }
    const actor = String(event.actor || 'agent').trim();
    if (!ACTOR_ID.test(actor)) throw lifecycleError('Lifecycle actor is invalid', 'INVALID_LIFECYCLE_ACTOR');
    const phase = event.phase == null ? null : String(event.phase).trim();
    const nodeId = event.nodeId == null ? null : String(event.nodeId).trim();
    if ((phase && !ACTOR_ID.test(phase)) || (nodeId && !ACTOR_ID.test(nodeId))) {
      throw lifecycleError('Lifecycle phase or node is invalid', 'INVALID_LIFECYCLE_SCOPE');
    }
    const run = loadRun(rootDir, runId);
    if (NODE_TYPES.has(event.type)) {
      if (!nodeId) throw lifecycleError('Node lifecycle events require a node Technical ID', 'INVALID_LIFECYCLE_SCOPE');
      if (!run.workflow) throw lifecycleError('Classic Runs cannot publish node-scoped activity', 'INVALID_LIFECYCLE_SCOPE');
      const { workflowStatus } = require('./workflow-runtime.js');
      const workflow = workflowStatus(rootDir, { runId });
      if (!workflow.plan.nodes.some((node) => node.id === nodeId)) {
        throw lifecycleError(`Node ${nodeId} is not part of Run ${runId}`, 'INVALID_LIFECYCLE_SCOPE');
      }
    } else if (nodeId) {
      throw lifecycleError('Run lifecycle events cannot claim a node scope', 'INVALID_LIFECYCLE_SCOPE');
    }
    const status = event.status == null ? null : String(event.status).trim().toUpperCase();
    if (status && !STATUSES.has(status)) {
      throw lifecycleError('Lifecycle status is invalid', 'INVALID_LIFECYCLE_STATUS');
    }
    let evidence = null;
    if (event.evidence != null) {
      const evidencePath = String(event.evidence.path || '').trim();
      const evidenceHash = event.evidence.sha256 == null ? null : String(event.evidence.sha256).trim();
      if (!evidencePath || evidencePath.length > 240 || path.isAbsolute(evidencePath) ||
          evidencePath.split(/[\\/]/).includes('..') ||
          (evidenceHash && !/^[a-f0-9]{64}$/.test(evidenceHash))) {
        throw lifecycleError('Lifecycle evidence reference is invalid', 'INVALID_LIFECYCLE_EVIDENCE');
      }
      evidence = { path: evidencePath, ...(evidenceHash ? { sha256: evidenceHash } : {}) };
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
    return ledger.append(rootDir, runId, events, {
      type: event.type,
      actor,
      message,
      ...(phase ? { phase } : {}),
      ...(nodeId ? { nodeId } : {}),
      ...(status ? { status } : {}),
      ...(evidence ? { evidence } : {})
    }, now);
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

function readAllRunLifecycle(rootDir, runId) {
  return readLifecycle(rootDir, runId);
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
  readAllRunLifecycle,
  runAgentPresence
};
