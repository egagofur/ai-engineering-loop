'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRun, transitionRun } = require('../lib/run-state.js');
const {
  createClaimedVsRealityTemplate,
  parseClaimedVsReality,
  readyForDa
} = require('../lib/claimed-vs-reality.js');

test('AC-4 filled table is ready for DA', () => {
  const md = `# Claimed vs Reality

| AC | Claimed | Reality |
|---|---|---|
| AC-1 | overlay writes workflow.md | npm test exit 0; AC-1 test passed |
| AC-2 | missing overlay is default | npm test exit 0; AC-2 test passed |
`;
  const { rows } = parseClaimedVsReality(md);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(readyForDa(md), true);
});

test('AC-5 empty Reality or seems-green is not ready for DA', () => {
  assert.strictEqual(readyForDa(''), false);
  assert.strictEqual(readyForDa('# Claimed vs Reality\n'), false);
  const emptyReality = `| AC | Claimed | Reality |\n|---|---|---|\n| AC-1 | tests pass |  |\n`;
  assert.strictEqual(readyForDa(emptyReality), false);
  const seems = `| AC | Claimed | Reality |\n|---|---|---|\n| AC-1 | tests pass | seems green |\n`;
  assert.strictEqual(readyForDa(seems), false);
});

test('claimed-vs-reality scaffold lists frozen criteria but leaves evidence blank', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-claimed-reality-'));
  createRun(root, { runId: 'run-001', task: 'Exercise criterion scaffolding' });
  const runDir = path.join(root, '.ai-engineering-loop/runs/run-001');
  const goalPath = path.join(runDir, 'goal-contract.json');
  fs.writeFileSync(goalPath, JSON.stringify({
    schemaVersion: 1,
    runId: 'run-001',
    objective: 'Create a trustworthy evidence table.',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'The scaffold must not invent verification.',
      evidenceRequired: 'A test of the generated table.',
      failureCases: ['Claimed or Reality is pre-filled.']
    }]
  }));
  transitionRun(root, 'run-001', 'GOAL_FROZEN', {
    gate: 'goal',
    artifacts: {
      goalContract: {
        path: '.ai-engineering-loop/runs/run-001/goal-contract.json',
        sha256: crypto.createHash('sha256').update(fs.readFileSync(goalPath)).digest('hex')
      }
    }
  });

  const result = createClaimedVsRealityTemplate(root, { runId: 'run-001' });
  const markdown = fs.readFileSync(path.join(root, result.path), 'utf8');
  const row = parseClaimedVsReality(markdown).rows[0];

  assert.match(markdown, /AC-1/);
  assert.match(markdown, /The scaffold must not invent verification/);
  assert.equal(row.claimed, '');
  assert.equal(row.reality, '');
  assert.equal(readyForDa(markdown), false);
});
