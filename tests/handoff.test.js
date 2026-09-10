'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createHandoff,
  handoffBrief,
  readHandoff,
  recordDecision,
  verifyHandoff
} = require('../lib/handoff.js');
const { createRun } = require('../lib/run-state.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-handoff-'));
}

function fixtureRun(root) {
  return createRun(root, {
    runId: 'handoff-001',
    mode: 'ASSISTED',
    task: 'Continue from /Users/private-user/project with sk-live-secretvalue123456',
    now: new Date('2025-01-01T00:00:00.000Z')
  });
}

test('handoff exports metadata without source and redacts secrets and home paths', () => {
  const root = tempRepo();
  fixtureRun(root);
  const bundle = createHandoff(root, {
    audience: 'agent',
    now: new Date('2025-01-02T00:00:00.000Z')
  });
  const serialized = JSON.stringify(bundle);
  assert.equal(bundle.sourceIncluded, false);
  assert.equal(bundle.redacted, true);
  assert.doesNotMatch(serialized, /private-user|secretvalue/);
  assert.match(serialized, /\[REDACTED HOME\]/);
  assert.ok(bundle.redactionCategories.includes('HOME_PATH'));
  assert.equal(verifyHandoff(bundle).valid, true);
  assert.match(handoffBrief(bundle), /# Engineering Handoff/);
});

test('handoff verification rejects tampering and unsafe files', () => {
  const root = tempRepo();
  fixtureRun(root);
  const bundle = createHandoff(root);
  assert.throws(
    () => verifyHandoff({ ...bundle, finalState: 'DELIVERED' }),
    { code: 'HANDOFF_TAMPERED' }
  );
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.json`);
  fs.writeFileSync(outside, JSON.stringify(bundle));
  assert.throws(() => readHandoff(root, outside), /escapes repository/);
  const link = path.join(root, 'handoff.json');
  fs.symlinkSync(outside, link);
  assert.throws(() => readHandoff(root, 'handoff.json'), /regular file/);
});

test('decision memory is bounded, redacted, and included in the handoff', () => {
  const root = tempRepo();
  fixtureRun(root);
  const result = recordDecision(root, {
    summary: 'Use the compiled DAG',
    rationale: 'Prevents token sk-live-secretvalue123456 from bypassing deterministic gates.',
    consequences: ['Studio remains a thin client.'],
    now: new Date('2025-01-01T01:00:00.000Z')
  });
  assert.equal(result.decision.id, 'decision-001');
  assert.match(result.decision.rationale, /\[REDACTED API TOKEN\]/);
  assert.equal(createHandoff(root).content.decisions[0].summary, 'Use the compiled DAG');
  assert.throws(
    () => recordDecision(root, { summary: '', rationale: 'missing summary' }),
    { code: 'INVALID_DECISION' }
  );
});
