'use strict';

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./recipe.js');
const { redactSecrets } = require('./safe-context.js');
const {
  RUN_STATES,
  atomicWriteJson,
  getCurrentRun,
  loadRun,
  runsDir
} = require('./run-state.js');

const NODE_STATES = Object.freeze({
  PENDING: 'PENDING',
  READY: 'READY',
  RUNNING: 'RUNNING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  BLOCKED: 'BLOCKED'
});
const SUCCESS_STATES = new Set([NODE_STATES.PASSED, NODE_STATES.SKIPPED]);
const LEGACY_NODE_TYPES = new Set([
  'goal-contract',
  'maker',
  'verification',
  'devil-advocate',
  'judge',
  'report',
  'delivery'
]);
const LOCK_STALE_MS = 60_000;

function runtimeError(message, code = 'WORKFLOW_RUNTIME_FAILED', details = []) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function workflowPaths(rootDir, runId) {
  const directory = path.join(runsDir(rootDir), runId);
  return {
    directory,
    plan: path.join(directory, 'plan.json'),
    state: path.join(directory, 'workflow-state.json'),
    events: path.join(directory, 'events.jsonl'),
    lock: path.join(directory, 'workflow.lock')
  };
}

function evaluateCondition(condition, run) {
  const values = {
    'run.mode': run.mode,
    'run.state': run.state,
    'run.iteration': run.iteration,
    'run.task': run.task
  };
  const actual = values[condition.field];
  switch (condition.operator) {
    case 'equals': return actual === condition.value;
    case 'notEquals': return actual !== condition.value;
    case 'contains':
      return Array.isArray(actual)
        ? actual.includes(condition.value)
        : String(actual || '').includes(String(condition.value));
    case 'matchesAny':
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'exists': return actual !== undefined && actual !== null;
    case 'isEmpty': return actual == null || actual === '' || (Array.isArray(actual) && actual.length === 0);
    case 'greaterThan': return typeof actual === 'number' && actual > condition.value;
    case 'lessThan': return typeof actual === 'number' && actual < condition.value;
    default: throw runtimeError(`Unsupported condition operator: ${condition.operator}`, 'INVALID_CONDITION');
  }
}

function refreshNodes(plan, state, run) {
  const changes = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of plan.nodes) {
      const current = state.nodes[node.id];
      if (![NODE_STATES.PENDING, NODE_STATES.BLOCKED].includes(current.status)) continue;
      const dependencies = (node.dependsOn || []).map((id) => state.nodes[id]);
      let nextStatus = current.status;
      let reason = null;
      if (dependencies.some((dependency) => dependency.status === NODE_STATES.FAILED)) {
        nextStatus = NODE_STATES.BLOCKED;
        reason = 'dependency failed';
      } else if (dependencies.every((dependency) => SUCCESS_STATES.has(dependency.status))) {
        if (node.when && !evaluateCondition(node.when, run)) {
          nextStatus = NODE_STATES.SKIPPED;
          reason = 'condition evaluated false';
        } else if (node.type === 'condition') {
          const result = evaluateCondition(node.expression, run);
          nextStatus = result ? NODE_STATES.PASSED : NODE_STATES.SKIPPED;
          reason = `condition evaluated ${result}`;
        } else {
          nextStatus = NODE_STATES.READY;
        }
      } else {
        nextStatus = NODE_STATES.PENDING;
      }
      if (nextStatus !== current.status || current.reason !== reason) {
        const replacement = { ...current, status: nextStatus, reason };
        state.nodes[node.id] = replacement;
        changes.push({ nodeId: node.id, from: current.status, node: replacement });
        changed = true;
      }
    }
  }
  return changes;
}

function eventWithHash(event) {
  return { ...event, hash: sha256(event) };
}

function createWorkflowBundle(plan, runId, { now = new Date(), run } = {}) {
  const runtimeRun = run || {
    runId,
    mode: plan.mode,
    state: RUN_STATES.STARTED,
    iteration: 1,
    task: ''
  };
  const state = {
    schemaVersion: 1,
    runId,
    graphHash: plan.graphHash,
    sequence: 0,
    eventHash: null,
    nodes: Object.fromEntries(plan.nodes.map((node) => [
      node.id,
      {
        status: NODE_STATES.PENDING,
        attempts: 0,
        reason: null,
        updatedAt: now.toISOString()
      }
    ]))
  };
  refreshNodes(plan, state, runtimeRun);
  const event = eventWithHash({
    schemaVersion: 1,
    sequence: 1,
    previousHash: null,
    at: now.toISOString(),
    type: 'WORKFLOW_CREATED',
    runId,
    graphHash: plan.graphHash,
    initialNodes: state.nodes
  });
  state.sequence = event.sequence;
  state.eventHash = event.hash;
  return { plan, state, events: [event] };
}

function readRegularJson(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (cause) {
    throw runtimeError(`Unable to inspect ${label}: ${cause.message}`, 'INVALID_WORKFLOW_STATE');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw runtimeError(`${label} must be a regular file`, 'INVALID_WORKFLOW_STATE');
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw runtimeError(`Unable to read ${label}: ${cause.message}`, 'INVALID_WORKFLOW_STATE');
  }
}

function readEvents(filePath, runId, graphHash) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw runtimeError('Workflow event log must be a regular file', 'INVALID_WORKFLOW_EVENTS');
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const events = text.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (cause) {
      throw runtimeError(`Workflow event ${index + 1} is invalid JSON: ${cause.message}`, 'INVALID_WORKFLOW_EVENTS');
    }
  });
  let previousHash = null;
  events.forEach((event, index) => {
    const { hash, ...material } = event;
    if (
      event.sequence !== index + 1 ||
      event.previousHash !== previousHash ||
      event.runId !== runId ||
      event.graphHash !== graphHash ||
      hash !== sha256(material)
    ) {
      throw runtimeError(`Workflow event ${index + 1} failed integrity validation`, 'INVALID_WORKFLOW_EVENTS');
    }
    previousHash = hash;
  });
  return events;
}

function verifyPlan(plan, expectedHash) {
  const material = {
    schemaVersion: plan.schemaVersion,
    compilerVersion: plan.compilerVersion,
    recipe: plan.recipe,
    mode: plan.mode,
    nodes: plan.nodes
  };
  if (plan.graphHash !== expectedHash || sha256(material) !== plan.graphHash) {
    throw runtimeError('Compiled workflow plan failed integrity validation', 'WORKFLOW_PLAN_TAMPERED');
  }
}

function recoverState(state, events) {
  const created = events[0];
  if (created?.type !== 'WORKFLOW_CREATED' || !created.initialNodes) {
    throw runtimeError('Workflow event log has no valid creation event', 'INVALID_WORKFLOW_EVENTS');
  }
  const recovered = {
    schemaVersion: 1,
    runId: state.runId,
    graphHash: state.graphHash,
    sequence: created.sequence,
    eventHash: created.hash,
    nodes: created.initialNodes
  };
  for (const event of events.slice(1)) {
    for (const change of event.changes || []) recovered.nodes[change.nodeId] = change.node;
    recovered.sequence = event.sequence;
    recovered.eventHash = event.hash;
  }
  return recovered;
}

function loadWorkflow(rootDir, runId) {
  const run = loadRun(rootDir, runId);
  if (!run.workflow) throw runtimeError(`Run ${runId} has no workflow recipe`, 'RUN_HAS_NO_WORKFLOW');
  const paths = workflowPaths(rootDir, runId);
  const plan = readRegularJson(paths.plan, 'workflow plan');
  verifyPlan(plan, run.workflow.graphHash);
  const state = readRegularJson(paths.state, 'workflow state');
  if (state.runId !== runId || state.graphHash !== plan.graphHash) {
    throw runtimeError('Workflow state identity does not match the run', 'INVALID_WORKFLOW_STATE');
  }
  const events = readEvents(paths.events, runId, plan.graphHash);
  const recovered = recoverState(state, events);
  if (JSON.stringify(recovered) !== JSON.stringify(state)) atomicWriteJson(paths.state, recovered);
  return { run, plan, state: recovered, events };
}

function appendEvent(filePath, event) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_APPEND | fs.constants.O_WRONLY | noFollow
    );
    if (!fs.fstatSync(descriptor).isFile()) throw new Error('event log is not a regular file');
    fs.writeSync(descriptor, `${JSON.stringify(event)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
  }
}

function commitChanges(rootDir, workflow, type, changes, metadata = {}, now = new Date()) {
  if (changes.length === 0) return workflow;
  const event = eventWithHash({
    schemaVersion: 1,
    sequence: workflow.state.sequence + 1,
    previousHash: workflow.state.eventHash,
    at: now.toISOString(),
    type,
    runId: workflow.run.runId,
    graphHash: workflow.plan.graphHash,
    changes,
    ...metadata
  });
  const paths = workflowPaths(rootDir, workflow.run.runId);
  appendEvent(paths.events, event);
  workflow.state.sequence = event.sequence;
  workflow.state.eventHash = event.hash;
  atomicWriteJson(paths.state, workflow.state);
  workflow.events.push(event);
  return workflow;
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    fs.closeSync(descriptor);
  } catch (cause) {
    if (cause.code !== 'EEXIST') throw cause;
    const age = Date.now() - fs.lstatSync(lockPath).mtimeMs;
    if (age <= LOCK_STALE_MS) throw runtimeError('Workflow is locked by another operation', 'WORKFLOW_LOCKED');
    fs.unlinkSync(lockPath);
    return acquireLock(lockPath);
  }
}

function withWorkflowLock(rootDir, runId, operation) {
  const lockPath = workflowPaths(rootDir, runId).lock;
  acquireLock(lockPath);
  try {
    return operation();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // A failed cleanup is treated as a stale lock on the next operation.
    }
  }
}

function resolveRunId(rootDir, runId) {
  if (runId) return runId;
  const run = getCurrentRun(rootDir);
  if (!run) throw runtimeError('No current run. Pass --run <id>.', 'NO_CURRENT_RUN');
  return run.runId;
}

function nodeChanges(workflow, nodeId, status, metadata = {}, now = new Date()) {
  const current = workflow.state.nodes[nodeId];
  if (!current) throw runtimeError(`Unknown workflow node: ${nodeId}`, 'UNKNOWN_WORKFLOW_NODE');
  const replacement = {
    ...current,
    status,
    updatedAt: now.toISOString(),
    ...metadata
  };
  workflow.state.nodes[nodeId] = replacement;
  return [{ nodeId, from: current.status, node: replacement }];
}

function assertReady(workflow, nodeId) {
  const node = workflow.plan.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw runtimeError(`Unknown workflow node: ${nodeId}`, 'UNKNOWN_WORKFLOW_NODE');
  const runtimeNode = workflow.state.nodes[nodeId];
  if (runtimeNode.status !== NODE_STATES.READY) {
    throw runtimeError(`Node ${nodeId} is ${runtimeNode.status}, not READY`, 'NODE_NOT_READY');
  }
  return node;
}

function safeArtifact(rootDir, artifactPath) {
  if (!artifactPath) throw runtimeError('An artifact path is required', 'ARTIFACT_REQUIRED');
  const absolute = path.resolve(rootDir, artifactPath);
  if (absolute !== rootDir && !absolute.startsWith(`${path.resolve(rootDir)}${path.sep}`)) {
    throw runtimeError('Artifact path must stay inside the repository', 'UNSAFE_ARTIFACT_PATH');
  }
  const realRoot = fs.realpathSync(rootDir);
  const realArtifact = fs.realpathSync(absolute);
  if (!realArtifact.startsWith(`${realRoot}${path.sep}`)) {
    throw runtimeError('Artifact path escapes the repository through a symlink', 'UNSAFE_ARTIFACT_PATH');
  }
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw runtimeError('Artifact must be a regular file, not a symlink', 'UNSAFE_ARTIFACT_PATH');
  }
  return {
    absolute,
    descriptor: {
      path: path.relative(rootDir, absolute).split(path.sep).join('/'),
      sha256: sha256(fs.readFileSync(absolute))
    }
  };
}

function validateSchema(value, schema, location = '$') {
  const errors = [];
  const typeMatches = {
    object: value && typeof value === 'object' && !Array.isArray(value),
    array: Array.isArray(value),
    string: typeof value === 'string',
    integer: Number.isSafeInteger(value),
    number: typeof value === 'number' && Number.isFinite(value),
    boolean: typeof value === 'boolean',
    null: value === null
  };
  if (schema.$ref) return [`${location}: $ref is not supported by the runtime validator`];
  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type && !allowedTypes.some((type) => typeMatches[type])) {
    return [`${location}: must be ${allowedTypes.join(' or ')}`];
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) errors.push(`${location}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${location}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${location}: is too short`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${location}: is too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location}: does not match ${schema.pattern}`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${location}: must be a date-time`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${location}: is below minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${location}: exceeds maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${location}: has too few items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${location}: has too many items`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push(`${location}: items must be unique`);
    }
    value.forEach((item, index) => errors.push(...validateSchema(item, schema.items || {}, `${location}[${index}]`)));
  }
  if (typeMatches.object) {
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}.${required}: is required`);
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) errors.push(...validateSchema(value[key], child, `${location}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) errors.push(`${location}.${key}: is not allowed`);
      }
    }
  }
  return errors;
}

function assertSupportedSchema(schema, location = '$schema') {
  const supported = new Set([
    '$schema',
    '$id',
    'title',
    'description',
    'type',
    'required',
    'properties',
    'const',
    'enum',
    'minLength',
    'maxLength',
    'pattern',
    'format',
    'minimum',
    'maximum',
    'minItems',
    'maxItems',
    'uniqueItems',
    'items',
    'additionalProperties'
  ]);
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw runtimeError(`${location} must be an object`, 'UNSUPPORTED_ARTIFACT_SCHEMA');
  }
  const unknown = Object.keys(schema).filter((key) => !supported.has(key));
  if (unknown.length) {
    throw runtimeError(
      `${location} uses unsupported keywords: ${unknown.join(', ')}`,
      'UNSUPPORTED_ARTIFACT_SCHEMA'
    );
  }
  if (schema.format && schema.format !== 'date-time') {
    throw runtimeError(`${location} uses unsupported format: ${schema.format}`, 'UNSUPPORTED_ARTIFACT_SCHEMA');
  }
  if (
    schema.additionalProperties != null &&
    typeof schema.additionalProperties !== 'boolean'
  ) {
    throw runtimeError(`${location}.additionalProperties must be boolean`, 'UNSUPPORTED_ARTIFACT_SCHEMA');
  }
  for (const [key, child] of Object.entries(schema.properties || {})) {
    assertSupportedSchema(child, `${location}.properties.${key}`);
  }
  if (schema.items) assertSupportedSchema(schema.items, `${location}.items`);
}

function validateNodeArtifact(rootDir, run, node, artifactPath) {
  const artifact = safeArtifact(rootDir, artifactPath);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(artifact.absolute, 'utf8'));
  } catch (cause) {
    throw runtimeError(`Artifact must be valid JSON: ${cause.message}`, 'INVALID_NODE_ARTIFACT');
  }
  if (value.runId !== run.runId) {
    throw runtimeError(`Artifact runId must be ${run.runId}`, 'INVALID_NODE_ARTIFACT');
  }
  const schemaRelative = node.output?.schema;
  const candidates = [
    { base: rootDir, file: path.resolve(rootDir, schemaRelative) },
    { base: path.resolve(__dirname, '..'), file: path.resolve(__dirname, '..', schemaRelative) }
  ];
  const schemaPath = candidates.find((candidate) => {
    if (!fs.existsSync(candidate.file)) return false;
    const realBase = fs.realpathSync(candidate.base);
    const realFile = fs.realpathSync(candidate.file);
    return realFile.startsWith(`${realBase}${path.sep}`);
  })?.file;
  if (!schemaPath) throw runtimeError(`Artifact schema not found: ${schemaRelative}`, 'INVALID_NODE_ARTIFACT');
  const schema = readRegularJson(schemaPath, 'node artifact schema');
  assertSupportedSchema(schema);
  const errors = validateSchema(value, schema);
  if (errors.length) throw runtimeError('Node artifact failed schema validation', 'INVALID_NODE_ARTIFACT', errors);
  return { ...artifact.descriptor, schema: schemaRelative };
}

function completeWorkflowNode(rootDir, nodeId, { runId, artifact, now = new Date() } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    const workflow = loadWorkflow(rootDir, resolved);
    const node = workflow.plan.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw runtimeError(`Unknown workflow node: ${nodeId}`, 'UNKNOWN_WORKFLOW_NODE');
    const currentStatus = workflow.state.nodes[nodeId].status;
    if (![NODE_STATES.READY, NODE_STATES.RUNNING].includes(currentStatus)) {
      throw runtimeError(`Node ${nodeId} is ${currentStatus}, not READY or RUNNING`, 'NODE_NOT_READY');
    }
    if (node.type === 'command') {
      throw runtimeError('Command nodes are disabled in the controlled runtime', 'COMMAND_EXECUTION_DISABLED');
    }
    if (node.type === 'approval' || LEGACY_NODE_TYPES.has(node.type)) {
      throw runtimeError(`Node ${nodeId} must use its dedicated approval or gate command`, 'WRONG_NODE_EXECUTOR');
    }
    let artifactDescriptor = null;
    if (node.type === 'agent') {
      artifactDescriptor = validateNodeArtifact(rootDir, workflow.run, node, artifact);
    } else if (node.type === 'artifact-check') {
      artifactDescriptor = safeArtifact(rootDir, artifact).descriptor;
    }
    let changes = nodeChanges(workflow, nodeId, NODE_STATES.PASSED, {
      attempts: workflow.state.nodes[nodeId].attempts + (currentStatus === NODE_STATES.READY ? 1 : 0),
      reason: null,
      activity: null,
      ...(artifactDescriptor ? { artifact: artifactDescriptor } : {})
    }, now);
    changes = changes.concat(refreshNodes(workflow.plan, workflow.state, workflow.run));
    return commitChanges(rootDir, workflow, 'NODE_COMPLETED', changes, { nodeId }, now);
  });
}

function startWorkflowNode(rootDir, nodeId, { runId, now = new Date() } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    const workflow = loadWorkflow(rootDir, resolved);
    const node = assertReady(workflow, nodeId);
    if (node.type === 'command') {
      throw runtimeError('Command nodes are disabled in the controlled runtime', 'COMMAND_EXECUTION_DISABLED');
    }
    if (node.type === 'approval' || LEGACY_NODE_TYPES.has(node.type)) {
      throw runtimeError(`Node ${nodeId} must use its dedicated approval or gate command`, 'WRONG_NODE_EXECUTOR');
    }
    const changes = nodeChanges(workflow, nodeId, NODE_STATES.RUNNING, {
      attempts: workflow.state.nodes[nodeId].attempts + 1,
      reason: null,
      activity: 'Node started'
    }, now);
    return commitChanges(rootDir, workflow, 'NODE_STARTED', changes, { nodeId }, now);
  });
}

function recordWorkflowActivity(rootDir, nodeId, { runId, message, now = new Date() } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    const workflow = loadWorkflow(rootDir, resolved);
    const current = workflow.state.nodes[nodeId];
    if (!current) throw runtimeError(`Unknown workflow node: ${nodeId}`, 'UNKNOWN_WORKFLOW_NODE');
    if (current.status !== NODE_STATES.RUNNING) {
      throw runtimeError(`Node ${nodeId} is ${current.status}, not RUNNING`, 'INVALID_NODE_TRANSITION');
    }
    const activity = redactSecrets(String(message || '').trim()).text;
    if (!activity || activity.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(activity)) {
      throw runtimeError('Activity must be 1-240 printable characters', 'INVALID_NODE_ACTIVITY');
    }
    const changes = nodeChanges(workflow, nodeId, NODE_STATES.RUNNING, { activity }, now);
    return commitChanges(rootDir, workflow, 'NODE_ACTIVITY', changes, { nodeId }, now);
  });
}

function failWorkflowNode(rootDir, nodeId, { runId, reason = 'node execution failed', now = new Date() } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    const workflow = loadWorkflow(rootDir, resolved);
    const current = workflow.state.nodes[nodeId];
    if (!current) throw runtimeError(`Unknown workflow node: ${nodeId}`, 'UNKNOWN_WORKFLOW_NODE');
    if (![NODE_STATES.READY, NODE_STATES.RUNNING].includes(current.status)) {
      throw runtimeError(`Node ${nodeId} cannot fail from ${current.status}`, 'INVALID_NODE_TRANSITION');
    }
    const safeReason = redactSecrets(String(reason)).text.slice(0, 500);
    let changes = nodeChanges(workflow, nodeId, NODE_STATES.FAILED, {
      attempts: current.attempts + (current.status === NODE_STATES.READY ? 1 : 0),
      reason: safeReason,
      activity: null
    }, now);
    changes = changes.concat(refreshNodes(workflow.plan, workflow.state, workflow.run));
    return commitChanges(rootDir, workflow, 'NODE_FAILED', changes, { nodeId }, now);
  });
}

function retryWorkflowNode(rootDir, nodeId, { runId, now = new Date() } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    const workflow = loadWorkflow(rootDir, resolved);
    const current = workflow.state.nodes[nodeId];
    if (!current) throw runtimeError(`Unknown workflow node: ${nodeId}`, 'UNKNOWN_WORKFLOW_NODE');
    if (![NODE_STATES.FAILED, NODE_STATES.RUNNING].includes(current.status)) {
      throw runtimeError(`Node ${nodeId} cannot retry from ${current.status}`, 'INVALID_NODE_TRANSITION');
    }
    let changes = nodeChanges(workflow, nodeId, NODE_STATES.READY, { reason: null, activity: null }, now);
    changes = changes.concat(refreshNodes(workflow.plan, workflow.state, workflow.run));
    return commitChanges(rootDir, workflow, 'NODE_RETRIED', changes, { nodeId }, now);
  });
}

function approveWorkflowNode(rootDir, nodeId, { runId, approvedBy = 'human', now = new Date() } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    if (!/^[A-Za-z0-9@._-]{1,64}$/.test(approvedBy)) {
      throw runtimeError('approvedBy must be a short account identifier', 'INVALID_APPROVER');
    }
    const workflow = loadWorkflow(rootDir, resolved);
    const node = assertReady(workflow, nodeId);
    if (node.type !== 'approval') {
      throw runtimeError(`Node ${nodeId} is not an approval node`, 'WRONG_NODE_EXECUTOR');
    }
    let changes = nodeChanges(workflow, nodeId, NODE_STATES.PASSED, {
      attempts: workflow.state.nodes[nodeId].attempts + 1,
      reason: null,
      activity: null,
      approvedBy
    }, now);
    changes = changes.concat(refreshNodes(workflow.plan, workflow.state, workflow.run));
    return commitChanges(rootDir, workflow, 'NODE_APPROVED', changes, { nodeId, approvedBy }, now);
  });
}

function descendants(plan, startId) {
  const result = new Set([startId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of plan.nodes) {
      if (!result.has(node.id) && (node.dependsOn || []).some((id) => result.has(id))) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

function applyWorkflowGate(rootDir, gate, { runId, now = new Date() } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    let workflow = loadWorkflow(rootDir, resolved);
    const node = workflow.plan.nodes.find((candidate) => candidate.legacyGate === gate);
    if (!node) throw runtimeError(`Workflow has no node for gate ${gate}`, 'GATE_NOT_IN_WORKFLOW');
    assertReady(workflow, node.id);
    const { applyGate } = require('./gates.js');
    const run = applyGate(rootDir, gate, { runId: resolved });
    workflow.run = run;
    let changes = nodeChanges(workflow, node.id, NODE_STATES.PASSED, {
      attempts: workflow.state.nodes[node.id].attempts + 1,
      reason: null,
      activity: null
    }, now);
    if (gate === 'judge' && run.state === RUN_STATES.GOAL_FROZEN) {
      const maker = workflow.plan.nodes.find((candidate) => candidate.type === 'maker');
      for (const resetId of descendants(workflow.plan, maker.id)) {
        const current = workflow.state.nodes[resetId];
        const replacement = {
          status: NODE_STATES.PENDING,
          attempts: current.attempts,
          reason: 'reset for next iteration',
          updatedAt: now.toISOString()
        };
        workflow.state.nodes[resetId] = replacement;
        changes.push({ nodeId: resetId, from: current.status, node: replacement });
      }
    } else if (run.state === RUN_STATES.ESCALATED) {
      for (const candidate of workflow.plan.nodes) {
        const current = workflow.state.nodes[candidate.id];
        if (![NODE_STATES.PASSED, NODE_STATES.SKIPPED].includes(current.status)) {
          const replacement = { ...current, status: NODE_STATES.BLOCKED, reason: 'run escalated', updatedAt: now.toISOString() };
          workflow.state.nodes[candidate.id] = replacement;
          changes.push({ nodeId: candidate.id, from: current.status, node: replacement });
        }
      }
    }
    if (run.state !== RUN_STATES.ESCALATED) {
      changes = changes.concat(refreshNodes(workflow.plan, workflow.state, run));
    }
    workflow = commitChanges(rootDir, workflow, 'GATE_PASSED', changes, { nodeId: node.id, gate }, now);
    return { run, workflow };
  });
}

function workflowStatus(rootDir, { runId } = {}) {
  return loadWorkflow(rootDir, resolveRunId(rootDir, runId));
}

module.exports = {
  NODE_STATES,
  createWorkflowBundle,
  loadWorkflow,
  workflowStatus,
  startWorkflowNode,
  completeWorkflowNode,
  failWorkflowNode,
  retryWorkflowNode,
  recordWorkflowActivity,
  approveWorkflowNode,
  applyWorkflowGate,
  evaluateCondition,
  assertSupportedSchema,
  validateSchema
};
