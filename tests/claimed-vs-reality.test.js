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
  assert.match(markdown, /\|\s*AC\s*\|\s*Claimed\s*\|\s*Reality from command log\s*\|\s*Layer\s*\|/);
  assert.equal(row.claimed, '');
  assert.equal(row.reality, '');
  assert.equal(readyForDa(markdown), false);
});

test('AC-2 scaffold template outputs 4-column header with Layer as 4th column', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-claimed-reality-ac2-'));
  createRun(root, { runId: 'run-ac2', task: 'Check template 4-column header' });
  const runDir = path.join(root, '.ai-engineering-loop/runs/run-ac2');
  const goalPath = path.join(runDir, 'goal-contract.json');
  fs.writeFileSync(goalPath, JSON.stringify({
    schemaVersion: 1,
    runId: 'run-ac2',
    objective: 'Test header format.',
    acceptanceCriteria: [{
      id: 'AC-1',
      statement: 'Must have 4 columns.',
      evidenceRequired: 'Header match.'
    }]
  }));
  transitionRun(root, 'run-ac2', 'GOAL_FROZEN', {
    gate: 'goal',
    artifacts: {
      goalContract: {
        path: '.ai-engineering-loop/runs/run-ac2/goal-contract.json',
        sha256: crypto.createHash('sha256').update(fs.readFileSync(goalPath)).digest('hex')
      }
    }
  });

  const result = createClaimedVsRealityTemplate(root, { runId: 'run-ac2' });
  const markdown = fs.readFileSync(path.join(root, result.path), 'utf8');

  assert.match(markdown, /\|\s*AC\s*\|\s*Claimed\s*\|\s*Reality from command log\s*\|\s*Layer\s*\|/);
  assert.match(markdown, /\|---\|---\|---\|---\|/);
});

test('AC-3 legacy 3-column files pass readyForDa without Layer column', () => {
  const legacyMd = `# Claimed vs Reality

| AC | Claimed | Reality from command log |
|---|---|---|
| AC-1 | legacy criterion met | npm test exit 0; 5 passing |
| AC-2 | another legacy criterion | tsc exit 0 |
`;
  const { rows } = parseClaimedVsReality(legacyMd);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].ac, 'AC-1');
  assert.strictEqual(rows[0].claimed, 'legacy criterion met');
  assert.strictEqual(rows[0].reality, 'npm test exit 0; 5 passing');
  assert.strictEqual(rows[0].layer, undefined);
  assert.strictEqual(readyForDa(legacyMd), true);
});

test('AC-4 4-column files with Layer pass readyForDa, but empty Reality or seems green fails', () => {
  const valid4Col = `# Claimed vs Reality

| AC | Claimed | Reality from command log | Layer |
|---|---|---|---|
| AC-1 | cross-component contract verified | npm run e2e exit 0; 3 suites passed | L3 |
| AC-2 | unit math verified | npm test exit 0; 12 passed | L2 |
`;
  const { rows } = parseClaimedVsReality(valid4Col);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].layer, 'L3');
  assert.strictEqual(rows[1].layer, 'L2');
  assert.strictEqual(readyForDa(valid4Col), true);

  const emptyReality4Col = `# Claimed vs Reality

| AC | Claimed | Reality from command log | Layer |
|---|---|---|---|
| AC-1 | cross-component contract verified |  | L3 |
`;
  assert.strictEqual(readyForDa(emptyReality4Col), false);

  const seemsGreen4Col = `# Claimed vs Reality

| AC | Claimed | Reality from command log | Layer |
|---|---|---|---|
| AC-1 | cross-component contract verified | seems green | L3 |
`;
  assert.strictEqual(readyForDa(seemsGreen4Col), false);
});
