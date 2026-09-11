'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { freezeGoal, saveGoalDraft } = require('../lib/goal-runtime.js');
const { runCheckout, runNodeIo, studioAgentHandoff } = require('../lib/run-checkout.js');
const { appendRunQuestion } = require('../lib/run-interactions.js');
const { appendRunLifecycle, listRunLifecycle } = require('../lib/run-lifecycle.js');
const { createRun } = require('../lib/run-state.js');
const { createStudioRun } = require('../lib/studio-runtime.js');
const {
  failWorkflowNode,
  retryWorkflowNode,
  startWorkflowNode
} = require('../lib/workflow-runtime.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-v110-'));
}

function executionFixture(root) {
  const run = createStudioRun(root, { task: 'Exercise runtime evidence' });
  const draft = saveGoalDraft(root, run.runId, {
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Exercise runtime evidence.',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'Runtime evidence remains accurate.',
      evidenceRequired: 'Focused runtime test.',
      failureCases: ['Evidence is fabricated.']
    }]
  });
  freezeGoal(root, run.runId, {
    actor: 'tester',
    expectedRevision: draft.metadata.revision,
    expectedHash: draft.metadata.contentHash
  });
  return run;
}

test('AC-2 a bounded task creates exactly one Run bound to the default workflow', () => {
  const root = tempRepo();
  const run = createStudioRun(root, { task: 'Draft a safe release plan', recipeId: '' });
  assert.equal(run.task, 'Draft a safe release plan');
  assert.equal(run.workflow.recipeId, 'default');
  const runEntries = fs.readdirSync(path.join(root, '.ai-engineering-loop', 'runs'))
    .filter((entry) => entry !== 'current.json');
  assert.deepEqual(runEntries, [run.runId]);
  assert.throws(
    () => createStudioRun(root, { task: ' '.repeat(4) }),
    { code: 'INVALID_RUN_TASK' }
  );
  assert.deepEqual(
    fs.readdirSync(path.join(root, '.ai-engineering-loop', 'runs'))
      .filter((entry) => entry !== 'current.json'),
    [run.runId]
  );
});

test('AC-3 Agent handoff is provider-neutral, repository-relative, and bound to one Technical Run ID', () => {
  const root = tempRepo();
  const run = createStudioRun(root, {
    task: 'Continue from /Users/private/project without exposing sk-live-secretvalue123456'
  });
  const handoff = studioAgentHandoff(root, run.runId);
  assert.equal(handoff.runId, run.runId);
  assert.equal(handoff.externalDispatch, false);
  assert.match(handoff.prompt, new RegExp(run.runId, 'g'));
  assert.match(handoff.prompt, /From the repository root/);
  assert.match(handoff.prompt, /goal draft --run/);
  assert.match(handoff.prompt, /activity heartbeat --run/);
  assert.match(handoff.prompt, /Do not create a sibling Run/);
  assert.doesNotMatch(handoff.prompt, /OpenAI|Anthropic|Gemini|Grok|\/Users\/|secretvalue/i);
});

test('DA-01 Windows home redaction preserves valid handoff JSON and sibling content', () => {
  const root = tempRepo();
  const run = createStudioRun(root, {
    task: String.raw`C:\Users\bob`
  });
  const checkout = runCheckout(root, run.runId);
  const handoff = studioAgentHandoff(root, run.runId);
  assert.equal(checkout.run.task, '[REDACTED HOME]');
  assert.match(handoff.prompt, /\[REDACTED HOME\]/);
  assert.equal(handoff.externalDispatch, false);
});

test('DA2-S01 handoff redacts Unix, root, and UNC home locations', () => {
  for (const task of [
    'Read /home/alice/private/file.js',
    'Read /root/private/file.js',
    String.raw`Read \\fileserver\alice\private.txt`
  ]) {
    const root = tempRepo();
    const run = createStudioRun(root, { task });
    const handoff = studioAgentHandoff(root, run.runId);
    assert.match(handoff.prompt, /\[REDACTED HOME\]/);
    assert.doesNotMatch(handoff.prompt, /alice|fileserver|\/root/);
  }
});

test('DA2-S09 redaction covers macOS temporary workspace paths', () => {
  const { redactHomePaths } = require('../lib/safe-context.js');
  assert.equal(
    redactHomePaths('/private/var/folders/79/abc123/T/agent-output.json'),
    '[REDACTED TMP]'
  );
  assert.equal(
    redactHomePaths('/var/folders/79/abc123/T/agent-output.json'),
    '[REDACTED TMP]'
  );
});

test('AC-5 persisted Run state determines the visible first-run journey without invented progress', () => {
  const { runJourney } = require('../lib/run-journey.js');
  const { saveGoalDraft } = require('../lib/goal-runtime.js');
  const { appendRunQuestion } = require('../lib/run-interactions.js');
  const { workflowStatus } = require('../lib/workflow-runtime.js');
  const root = tempRepo();
  const run = createStudioRun(root, { task: 'Expose the real journey' });
  assert.equal(runJourney(root, run.runId).current, 'TASK_RECEIVED');

  saveGoalDraft(root, run.runId, {
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Expose the real journey.',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'Persisted state is visible.',
      evidenceRequired: 'Journey test.',
      failureCases: ['Progress is invented.']
    }]
  });
  assert.equal(runJourney(root, run.runId).current, 'READY_FOR_GOAL_FREEZE');

  appendRunQuestion(root, run.runId, { message: 'Which audience?', actor: 'agent' });
  const waiting = runJourney(root, run.runId);
  assert.equal(waiting.current, 'WAITING_FOR_ANSWERS');
  assert.equal(waiting.pendingQuestions, 1);

  const executingRoot = tempRepo();
  const executingRun = executionFixture(executingRoot);
  startWorkflowNode(executingRoot, 'maker', { runId: executingRun.runId });
  const workflow = workflowStatus(executingRoot, { runId: executingRun.runId });
  assert.equal(
    runJourney(executingRoot, executingRun.runId, { workflowState: workflow.state }).current,
    'WORKFLOW_EXECUTION'
  );
  fs.writeFileSync(
    path.join(executingRoot, '.ai-engineering-loop', 'runs', executingRun.runId, 'goal-draft.json'),
    '{'
  );
  const degraded = runJourney(executingRoot, executingRun.runId, { workflowState: workflow.state });
  assert.equal(degraded.current, 'WORKFLOW_EXECUTION');
  assert.equal(degraded.sources.draftAvailable, false);
  assert.deepEqual(degraded.degradedSources, ['Goal draft']);

  appendRunQuestion(executingRoot, executingRun.runId, {
    message: 'Is this degraded state visible?',
    actor: 'agent'
  });
  fs.appendFileSync(
    path.join(executingRoot, '.ai-engineering-loop', 'runs', executingRun.runId, 'interactions.jsonl'),
    '{'
  );
  const interactionDegraded = runJourney(
    executingRoot,
    executingRun.runId,
    { workflowState: workflow.state }
  );
  assert.equal(interactionDegraded.pendingQuestions, null);
  assert.ok(interactionDegraded.degradedSources.includes('Agent Interaction'));

  const longRoot = tempRepo();
  const longRun = executionFixture(longRoot);
  for (let index = 0; index < 101; index += 1) {
    appendRunLifecycle(longRoot, longRun.runId, {
      type: 'AGENT_HEARTBEAT',
      phase: 'maker',
      actor: 'terminal-agent',
      message: `Bounded progress event ${index + 1}`
    });
  }
  appendRunLifecycle(longRoot, longRun.runId, {
    type: 'NODE_STARTED',
    phase: 'maker',
    nodeId: 'maker',
    actor: 'terminal-agent',
    message: 'Maker started after a long Goal phase'
  });
  assert.equal(runJourney(longRoot, longRun.runId).current, 'WORKFLOW_EXECUTION');
});

test('AC-7 checkout connectors expose persisted traversal state instead of visual inference', () => {
  const root = tempRepo();
  const run = createStudioRun(root, { task: 'Render only real connector progress' });
  const checkout = runCheckout(root, run.runId);
  assert.ok(checkout.edges.length > 0);
  assert.ok(checkout.edges.every((edge) => edge.traversed === false));
  assert.ok(checkout.edges.every((edge) => edge.active === false));
});

test('DA-03 an Edge remains traversed after its target node fails', () => {
  const root = tempRepo();
  const run = executionFixture(root);
  startWorkflowNode(root, 'maker', { runId: run.runId, now: new Date('2026-01-01T00:00:00Z') });
  failWorkflowNode(root, 'maker', {
    runId: run.runId,
    reason: 'Expected test failure',
    now: new Date('2026-01-01T00:00:01Z')
  });
  const edge = runCheckout(root, run.runId).edges.find((candidate) => candidate.to === 'maker');
  assert.equal(edge.traversed, true);
  assert.equal(edge.active, false);
  assert.equal(edge.state, 'failed');
});

test('AC-8 Node I/O reports honest duration, Agent Interaction, and Loop Iteration empty states', () => {
  const root = tempRepo();
  const run = createStudioRun(root, { task: 'Inspect complete Node I/O' });
  const checkout = runCheckout(root, run.runId);
  const rootNode = checkout.nodes.find((node) => checkout.edges.every((edge) => edge.to !== node.id));
  const io = runNodeIo(root, run.runId, rootNode.id);
  assert.equal(io.durationMs, null);
  assert.deepEqual(io.agentInteractions, []);
  assert.equal(io.loopIteration, null);
  assert.equal(io.evidence, null);
  assert.ok(io.timeline.length > 0);
});

test('DA-04 Node I/O labels Run-wide interactions honestly and bounds the payload', () => {
  const root = tempRepo();
  const run = createStudioRun(root, { task: 'Bound interaction evidence' });
  const checkout = runCheckout(root, run.runId);
  const rootNode = checkout.nodes.find((node) => checkout.edges.every((edge) => edge.to !== node.id));
  for (let index = 1; index <= 55; index += 1) {
    appendRunQuestion(root, run.runId, { message: `Question ${index}`, actor: 'agent' });
  }
  const io = runNodeIo(root, run.runId, rootNode.id);
  assert.equal(io.agentInteractionScope, 'RUN');
  assert.equal(io.agentInteractions.length, 50);
  assert.equal(io.agentInteractions[0].message, 'Question 6');
});

test('DA2-S08 corrupt interactions degrade only the interaction section', () => {
  const root = tempRepo();
  const run = createStudioRun(root, { task: 'Keep Node I/O available' });
  const checkout = runCheckout(root, run.runId);
  const rootNode = checkout.nodes.find((node) => checkout.edges.every((edge) => edge.to !== node.id));
  fs.writeFileSync(
    path.join(root, '.ai-engineering-loop', 'runs', run.runId, 'interactions.jsonl'),
    '{invalid-json}\n'
  );
  const io = runNodeIo(root, run.runId, rootNode.id);
  assert.equal(io.agentInteractionsAvailable, false);
  assert.deepEqual(io.agentInteractions, []);
  assert.ok(io.timeline.length > 0);
});

test('DA-05 duration describes only the latest completed attempt', () => {
  const root = tempRepo();
  const run = executionFixture(root);
  startWorkflowNode(root, 'maker', { runId: run.runId, now: new Date('2026-01-01T00:00:00Z') });
  failWorkflowNode(root, 'maker', {
    runId: run.runId,
    reason: 'First attempt',
    now: new Date('2026-01-01T00:00:01Z')
  });
  retryWorkflowNode(root, 'maker', { runId: run.runId, now: new Date('2026-01-01T00:00:01Z') });
  startWorkflowNode(root, 'maker', { runId: run.runId, now: new Date('2026-01-01T00:00:01Z') });
  assert.equal(runNodeIo(root, run.runId, 'maker').durationMs, null);
  failWorkflowNode(root, 'maker', {
    runId: run.runId,
    reason: 'Second attempt',
    now: new Date('2026-01-01T00:00:05Z')
  });
  assert.equal(runNodeIo(root, run.runId, 'maker').durationMs, 4000);
});

test('AC-11 first-run controls expose bounded and keyboard-accessible semantics', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'studio', 'index.html'), 'utf8');
  assert.match(html, /id="goal-task"[^>]*required[^>]*aria-describedby="goal-task-help"/);
  assert.match(html, /id="goal-task-help"/);
  assert.match(html, /id="start-agent"[^>]*aria-describedby="agent-handoff-instructions"/);
  assert.match(html, /id="cancel-active-run-conflict"/);
});

test('AC-12 v1.10 keeps the existing CLI and packaged Studio entry points', () => {
  const packageJson = require('../package.json');
  assert.equal(packageJson.version, '1.10.0');
  assert.equal(packageJson.bin['ai-engineering-loop'], 'bin/ai-engineering-loop.js');
  assert.ok(packageJson.files.includes('studio/'));
  assert.equal(packageJson.scripts.test, 'node --test');
  assert.equal(packageJson.scripts.doctor, 'node bin/ai-engineering-loop.js doctor');
  assert.equal(packageJson.scripts.eval, 'node bin/ai-engineering-loop.js eval');
});

test('AC-13 structured execution events are bounded, ordered, and node-scoped', () => {
  const root = tempRepo();
  const run = executionFixture(root);
  const event = appendRunLifecycle(root, run.runId, {
    type: 'NODE_ACTIVITY',
    phase: 'maker',
    nodeId: 'maker',
    actor: 'terminal-agent',
    status: 'WORKING',
    message: 'Implementing the persisted execution protocol',
    evidence: { path: 'evidence/protocol.txt', sha256: 'a'.repeat(64) }
  });
  assert.equal(event.sequence, 1);
  assert.equal(event.nodeId, 'maker');
  assert.equal(event.status, 'WORKING');
  assert.deepEqual(listRunLifecycle(root, run.runId).events[0].evidence, {
    path: 'evidence/protocol.txt',
    sha256: 'a'.repeat(64)
  });
  assert.throws(() => appendRunLifecycle(root, run.runId, {
    type: 'NODE_ACTIVITY',
    phase: 'maker',
    nodeId: 'not-in-plan',
    actor: 'terminal-agent',
    message: 'Invalid node'
  }), /not part of Run/);
  assert.throws(() => appendRunLifecycle(root, run.runId, {
    type: 'NODE_ACTIVITY',
    phase: 'maker',
    nodeId: 'maker',
    actor: 'terminal-agent',
    message: 'x'.repeat(241)
  }), /1-240/);
});

test('F-005 Classic Run phase completion retains Run-scoped completion semantics', () => {
  const root = tempRepo();
  const run = createRun(root, { task: 'Exercise a Classic Run phase', runId: 'classic-001' });
  appendRunLifecycle(root, run.runId, {
    type: 'PHASE_COMPLETED',
    phase: 'review',
    actor: 'agent',
    status: 'PASSED',
    message: 'Review phase completed'
  });
  const [event] = listRunLifecycle(root, run.runId).events;
  assert.equal(event.type, 'PHASE_COMPLETED');
  assert.equal(event.status, 'PASSED');
  assert.equal(event.nodeId, undefined);
});

test('AC-14 Run Activity Dock exposes persisted Run and node focus without a fake node', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'studio', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
  assert.match(html, /id="run-activity-dock"[^>]*aria-live="polite"/);
  assert.match(html, /id="inspect-live-node"/);
  assert.match(app, /renderRunActivityDock\(live, active, runtimeNode, lifecycle\)/);
  assert.match(app, /inspect\.dataset\.nodeId = active\?\.id \|\| ''/);
  assert.match(app, /degradedSources\.join\(' and '\).*unavailable — journey may be incomplete/s);
});

test('AC-15 Node Inspector keeps human-readable tabs and honest running output', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'studio', 'styles.css'), 'utf8');
  for (const label of ['Input', 'Live Activity', 'Output', 'Evidence', 'Timeline']) {
    assert.ok(app.includes(`'${label}'`) || app.includes(`>${label}<`));
  }
  assert.match(app, /running \? 'In progress'/);
  assert.match(app, /role="tablist"/);
  assert.match(css, /\.io-tab\[aria-selected=true\]/);
});

test('AC-16 semantic node and connector states remain distinct without a passed glow', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'studio', 'styles.css'), 'utf8');
  for (const state of ['active', 'passed', 'failed', 'skipped', 'waiting', 'idle']) {
    assert.ok(app.includes(`'${state}'`), `missing semantic state ${state}`);
    assert.match(css, new RegExp(`edge-${state}`));
  }
  assert.match(css, /\.node\.passed\{border:1px solid/);
  assert.doesNotMatch(css, /\.node\.passed\{[^}]*glow/);
});

test('AC-17 lifecycle bursts coalesce rendering and reduced motion preserves state styling', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'studio', 'styles.css'), 'utf8');
  assert.match(app, /if \(liveRenderScheduled\) return/);
  assert.match(app, /window\.requestAnimationFrame/);
  assert.match(app, /lifecycleEvents = lifecycleEvents\.concat\([\s\S]*\)\.slice\(-100\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.edge\.edge-active/);
});
