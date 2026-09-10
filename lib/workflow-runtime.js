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
  runsDir,
  transitionRun
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
      const exitGuard = (plan.loopGroups || []).find((group) => group.exitTargetId === node.id);
      if (exitGuard && state.loopGroups?.[exitGuard.id]?.status !== 'EXITED') {
        nextStatus = NODE_STATES.PENDING;
        reason = `waiting for ${exitGuard.id} to exit`;
      } else if (dependencies.some((dependency) => dependency.status === NODE_STATES.FAILED)) {
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
  const loopMembership = new Map();
  for (const group of plan.loopGroups || []) {
    for (const nodeId of group.nodeIds) loopMembership.set(nodeId, group.id);
  }
  const state = {
    schemaVersion: 1,
    runId,
    graphHash: plan.graphHash,
    sequence: 0,
    eventHash: null,
    loopGroups: Object.fromEntries((plan.loopGroups || []).map((group) => [
      group.id,
      {
        status: 'PENDING',
        iteration: 1,
        maxIterations: group.maxIterations,
        lastOutcome: null,
        updatedAt: now.toISOString()
      }
    ])),
    nodes: Object.fromEntries(plan.nodes.map((node) => [
      node.id,
      {
        status: NODE_STATES.PENDING,
        attempts: 0,
        reason: null,
        ...(loopMembership.has(node.id)
          ? { loopGroupId: loopMembership.get(node.id), loopIteration: 1 }
          : {}),
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
    initialNodes: state.nodes,
    initialLoopGroups: state.loopGroups
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
  if (Object.hasOwn(plan, 'loopGroups')) material.loopGroups = plan.loopGroups;
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
    nodes: created.initialNodes,
    loopGroups: created.initialLoopGroups || {}
  };
  for (const event of events.slice(1)) {
    for (const change of event.changes || []) recovered.nodes[change.nodeId] = change.node;
    for (const change of event.loopChanges || []) recovered.loopGroups[change.groupId] = change.loop;
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

function commitChanges(
  rootDir,
  workflow,
  type,
  changes,
  metadata = {},
  now = new Date(),
  allowEmpty = false,
  loopChanges = []
) {
  if (changes.length === 0 && loopChanges.length === 0 && !allowEmpty) return workflow;
  const event = eventWithHash({
    schemaVersion: 1,
    sequence: workflow.state.sequence + 1,
    previousHash: workflow.state.eventHash,
    at: now.toISOString(),
    type,
    runId: workflow.run.runId,
    graphHash: workflow.plan.graphHash,
    changes,
    ...(loopChanges.length ? { loopChanges } : {}),
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

function loopChange(workflow, groupId, metadata, now = new Date()) {
  const current = workflow.state.loopGroups[groupId];
  if (!current) throw runtimeError(`Unknown Loop Group: ${groupId}`, 'UNKNOWN_LOOP_GROUP');
  const replacement = { ...current, ...metadata, updatedAt: now.toISOString() };
  workflow.state.loopGroups[groupId] = replacement;
  return { groupId, from: current.status, loop: replacement };
}

function loopForDecision(plan, nodeId) {
  return (plan.loopGroups || []).find((group) => group.decisionNodeId === nodeId);
}

function descendantsWithinLoop(plan, group) {
  const members = new Set(group.nodeIds);
  const result = new Set([group.repeatTargetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of plan.nodes) {
      if (
        members.has(node.id) &&
        !result.has(node.id) &&
        (node.dependsOn || []).some((dependency) => result.has(dependency))
      ) {
        result.add(node.id);
        changed = true;
      }
    }
  }
  return result;
}

function resetLoopNodes(workflow, group, iteration, now) {
  const changes = [];
  for (const nodeId of descendantsWithinLoop(workflow.plan, group)) {
    const current = workflow.state.nodes[nodeId];
    const replacement = {
      status: NODE_STATES.PENDING,
      attempts: current.attempts,
      reason: 'reset for next Loop iteration',
      activity: null,
      loopGroupId: group.id,
      loopIteration: iteration,
      updatedAt: now.toISOString()
    };
    workflow.state.nodes[nodeId] = replacement;
    changes.push({ nodeId, from: current.status, node: replacement });
  }
  return changes;
}

function assertDecisionActor(actor) {
  if (!/^[A-Za-z0-9@._-]{1,64}$/.test(String(actor || ''))) {
    throw runtimeError('actor must be a short account identifier', 'INVALID_LOOP_ACTOR');
  }
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
    if (node.type === 'decision') {
      throw runtimeError(`Node ${nodeId} requires an explicit decision outcome`, 'WRONG_NODE_EXECUTOR');
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

function resolveWorkflowDecision(
  rootDir,
  nodeId,
  { runId, outcome, actor = 'agent', now = new Date() } = {}
) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    assertDecisionActor(actor);
    const normalizedOutcome = String(outcome || '').trim();
    if (!normalizedOutcome || normalizedOutcome.length > 80) {
      throw runtimeError('A bounded decision outcome is required', 'INVALID_DECISION_OUTCOME');
    }
    const workflow = loadWorkflow(rootDir, resolved);
    const node = assertReady(workflow, nodeId);
    if (node.type !== 'decision' && node.type !== 'trigger') {
      throw runtimeError(`Node ${nodeId} is not a decision node`, 'WRONG_NODE_EXECUTOR');
    }
    const group = loopForDecision(workflow.plan, nodeId);
    if (group && ![group.repeatOutcome, group.exitOutcome].includes(normalizedOutcome)) {
      throw runtimeError(
        `Outcome must be ${group.repeatOutcome} or ${group.exitOutcome}`,
        'INVALID_LOOP_OUTCOME'
      );
    }

    const currentLoop = group ? workflow.state.loopGroups[group.id] : null;
    const metadata = {
      nodeId,
      outcome: redactSecrets(normalizedOutcome),
      actor,
      ...(group ? { groupId: group.id, iteration: currentLoop.iteration } : {})
    };
    if (!group) {
      let changes = nodeChanges(workflow, nodeId, NODE_STATES.PASSED, {
        attempts: workflow.state.nodes[nodeId].attempts + 1,
        reason: null,
        activity: null,
        outcome: normalizedOutcome
      }, now);
      changes = changes.concat(refreshNodes(workflow.plan, workflow.state, workflow.run));
      return commitChanges(rootDir, workflow, 'DECISION_RESOLVED', changes, metadata, now);
    }

    if (normalizedOutcome === group.exitOutcome) {
      let changes = nodeChanges(workflow, nodeId, NODE_STATES.PASSED, {
        attempts: workflow.state.nodes[nodeId].attempts + 1,
        reason: null,
        activity: null,
        outcome: normalizedOutcome,
        loopGroupId: group.id,
        loopIteration: currentLoop.iteration
      }, now);
      const loopChanges = [loopChange(workflow, group.id, {
        status: 'EXITED',
        lastOutcome: normalizedOutcome
      }, now)];
      changes = changes.concat(refreshNodes(workflow.plan, workflow.state, workflow.run));
      return commitChanges(rootDir, workflow, 'LOOP_EXITED', changes, metadata, now, false, loopChanges);
    }

    if (currentLoop.iteration >= currentLoop.maxIterations) {
      const changes = nodeChanges(workflow, nodeId, NODE_STATES.BLOCKED, {
        attempts: workflow.state.nodes[nodeId].attempts + 1,
        reason: 'Loop iteration limit reached',
        activity: null,
        outcome: normalizedOutcome,
        loopGroupId: group.id,
        loopIteration: currentLoop.iteration
      }, now);
      const loopChanges = [loopChange(workflow, group.id, {
        status: 'BLOCKED',
        lastOutcome: normalizedOutcome
      }, now)];
      return commitChanges(
        rootDir,
        workflow,
        'LOOP_LIMIT_REACHED',
        changes,
        metadata,
        now,
        false,
        loopChanges
      );
    }

    const nextIteration = currentLoop.iteration + 1;
    let changes = resetLoopNodes(workflow, group, nextIteration, now);
    const loopChanges = [loopChange(workflow, group.id, {
      status: 'RUNNING',
      iteration: nextIteration,
      lastOutcome: normalizedOutcome
    }, now)];
    changes = changes.concat(refreshNodes(workflow.plan, workflow.state, workflow.run));
    return commitChanges(
      rootDir,
      workflow,
      'LOOP_REPEATED',
      changes,
      { ...metadata, nextIteration },
      now,
      false,
      loopChanges
    );
  });
}

function resolveLoopLimit(
  rootDir,
  groupId,
  { runId, action, expectedIteration, actor, reason, now = new Date() } = {}
) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    assertDecisionActor(actor);
    const cleanReason = String(reason || '').trim();
    if (!cleanReason || cleanReason.length > 500) {
      throw runtimeError('A reason between 1 and 500 characters is required', 'INVALID_LOOP_REASON');
    }
    if (!['EXTRA_ITERATION', 'EXIT', 'STOP'].includes(action)) {
      throw runtimeError('Loop action must be EXTRA_ITERATION, EXIT, or STOP', 'INVALID_LOOP_ACTION');
    }
    const workflow = loadWorkflow(rootDir, resolved);
    const group = (workflow.plan.loopGroups || []).find((candidate) => candidate.id === groupId);
    if (!group) throw runtimeError(`Unknown Loop Group: ${groupId}`, 'UNKNOWN_LOOP_GROUP');
    const currentLoop = workflow.state.loopGroups[groupId];
    if (currentLoop.status !== 'BLOCKED') {
      throw runtimeError(`Loop Group ${groupId} is not blocked`, 'LOOP_NOT_BLOCKED');
    }
    if (currentLoop.iteration !== expectedIteration) {
      throw runtimeError('Loop Group iteration changed; refresh before approving', 'STALE_LOOP_APPROVAL');
    }
    const metadata = {
      groupId,
      action,
      iteration: currentLoop.iteration,
      actor,
      reason: redactSecrets(cleanReason)
    };

    if (action === 'EXTRA_ITERATION') {
      const nextIteration = currentLoop.iteration + 1;
      let changes = resetLoopNodes(workflow, group, nextIteration, now);
      const loopChanges = [loopChange(workflow, groupId, {
        status: 'RUNNING',
        iteration: nextIteration
      }, now)];
      changes = changes.concat(refreshNodes(workflow.plan, workflow.state, workflow.run));
      return commitChanges(
        rootDir,
        workflow,
        'LOOP_LIMIT_OVERRIDE',
        changes,
        { ...metadata, nextIteration },
        now,
        false,
        loopChanges
      );
    }

    if (action === 'EXIT') {
      let changes = nodeChanges(workflow, group.decisionNodeId, NODE_STATES.PASSED, {
        reason: null,
        activity: null,
        approvedBy: actor
      }, now);
      const loopChanges = [loopChange(workflow, groupId, { status: 'EXITED' }, now)];
      changes = changes.concat(refreshNodes(workflow.plan, workflow.state, workflow.run));
      return commitChanges(
        rootDir,
        workflow,
        'LOOP_LIMIT_EXITED',
        changes,
        metadata,
        now,
        false,
        loopChanges
      );
    }

    const changes = [];
    workflow.run = transitionRun(rootDir, resolved, RUN_STATES.CANCELLED, {
      gate: 'loop-limit-stop',
      reason: redactSecrets(cleanReason),
      historyMetadata: {
        actor,
        loopGroupId: groupId,
        loopIteration: currentLoop.iteration
      },
      now
    });
    for (const node of workflow.plan.nodes) {
      const current = workflow.state.nodes[node.id];
      if (!SUCCESS_STATES.has(current.status)) {
        changes.push(...nodeChanges(workflow, node.id, NODE_STATES.BLOCKED, {
          reason: 'Run stopped after Loop limit',
          activity: null
        }, now));
      }
    }
    const loopChanges = [loopChange(workflow, groupId, { status: 'STOPPED' }, now)];
    return commitChanges(
      rootDir,
      workflow,
      'LOOP_RUN_STOPPED',
      changes,
      metadata,
      now,
      false,
      loopChanges
    );
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

function applyWorkflowGate(rootDir, gate, { runId, now = new Date(), transitionOptions = {} } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    let workflow = loadWorkflow(rootDir, resolved);
    const node = workflow.plan.nodes.find((candidate) => candidate.legacyGate === gate);
    if (!node) throw runtimeError(`Workflow has no node for gate ${gate}`, 'GATE_NOT_IN_WORKFLOW');
    assertReady(workflow, node.id);
    const { applyGate } = require('./gates.js');
    const run = applyGate(rootDir, gate, { runId: resolved, transitionOptions });
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

function unfreezeWorkflowGoal(rootDir, { runId, transitionOptions, now = new Date() } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    let workflow = loadWorkflow(rootDir, resolved);
    const goalNode = workflow.plan.nodes.find((node) => node.legacyGate === 'goal');
    if (!goalNode) throw runtimeError('Workflow has no Goal Contract node', 'GATE_NOT_IN_WORKFLOW');
    const run = transitionRun(rootDir, resolved, RUN_STATES.STARTED, {
      gate: 'goal-unfreeze',
      ...transitionOptions,
      now
    });
    workflow.run = run;
    const changes = workflow.plan.nodes.map((node) => {
      const current = workflow.state.nodes[node.id];
      const replacement = {
        status: node.id === goalNode.id ? NODE_STATES.READY : NODE_STATES.PENDING,
        attempts: current.attempts,
        reason: node.id === goalNode.id ? null : 'Goal version changed',
        activity: null,
        updatedAt: now.toISOString()
      };
      workflow.state.nodes[node.id] = replacement;
      return { nodeId: node.id, from: current.status, node: replacement };
    });
    workflow = commitChanges(rootDir, workflow, 'GOAL_UNFROZEN', changes, {
      actor: transitionOptions.historyMetadata.actor,
      reason: transitionOptions.reason,
      goalVersion: transitionOptions.historyMetadata.goalVersion,
      nextGoalVersion: transitionOptions.historyMetadata.nextGoalVersion
    }, now);
    return { run, workflow };
  });
}

function startWorkflowExecution(rootDir, { runId, now = new Date() } = {}) {
  const resolved = resolveRunId(rootDir, runId);
  return withWorkflowLock(rootDir, resolved, () => {
    const workflow = loadWorkflow(rootDir, resolved);
    if (workflow.run.state !== RUN_STATES.GOAL_FROZEN || workflow.run.goal?.frozen !== true) {
      throw runtimeError('Execution requires a deliberately frozen Goal', 'GOAL_NOT_FROZEN');
    }
    if (workflow.run.mode === 'REPORT_ONLY') {
      throw runtimeError('REPORT_ONLY runs cannot execute a workflow', 'UNSUPPORTED_EXECUTION_MODE');
    }
    const roots = workflow.plan.nodes.filter((node) => (node.dependsOn || []).length === 0);
    if (roots.length !== 1 || !['goal-contract', 'trigger'].includes(roots[0].type)) {
      throw runtimeError(
        `Execution requires exactly one permitted trigger/root; found ${roots.length}`,
        'AMBIGUOUS_WORKFLOW_TRIGGER'
      );
    }
    const latestStart = workflow.events.findLastIndex((event) => event.type === 'WORKFLOW_EXECUTION_STARTED');
    const latestUnfreeze = workflow.events.findLastIndex((event) => event.type === 'GOAL_UNFROZEN');
    if (latestStart > latestUnfreeze) {
      throw runtimeError('Workflow execution is already active for this run', 'WORKFLOW_ALREADY_EXECUTING');
    }
    const { assertModeAllowed } = require('./runtime-policy.js');
    const { assertBudgetAvailable } = require('./budget.js');
    assertModeAllowed(rootDir, workflow.run.mode);
    const budget = assertBudgetAvailable(rootDir, { runId: resolved, now });
    return {
      workflow: commitChanges(rootDir, workflow, 'WORKFLOW_EXECUTION_STARTED', [], {
        triggerNodeId: roots[0].id,
        dispatch: 'LOCAL_RUNTIME_ONLY',
        externalDispatch: false
      }, now, true),
      budget
    };
  });
}

module.exports = {
  NODE_STATES,
  createWorkflowBundle,
  loadWorkflow,
  workflowStatus,
  unfreezeWorkflowGoal,
  startWorkflowExecution,
  startWorkflowNode,
  completeWorkflowNode,
  resolveWorkflowDecision,
  resolveLoopLimit,
  failWorkflowNode,
  retryWorkflowNode,
  recordWorkflowActivity,
  approveWorkflowNode,
  applyWorkflowGate,
  evaluateCondition,
  assertSupportedSchema,
  validateSchema
};
