'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRun, transitionRun } = require('../lib/run-state.js');
const {
  checkClaimedVsReality,
  createClaimedVsRealityTemplate,
  parseClaimedVsReality,
  parseLayerCell,
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

const table = (rows) => `| AC | Claimed | Reality from command log | Layer |\n|---|---|---|---|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
const crossGoal = {
  acceptanceCriteria: [
    { id: 'AC-1', statement: 'export writes file', crossComponent: true },
    { id: 'AC-2', statement: 'pure formatter', crossComponent: false }
  ]
};

test('#110 Layer cell parses combos and waivers; unknown tokens are rejected with a FIX', () => {
  const combo = parseLayerCell('L1+L2+L3');
  assert.deepStrictEqual([...combo.layers].sort(), ['L1', 'L2', 'L3']);
  const waived = parseLayerCell('L2; L3 waived: no e2e harness in this repo yet');
  assert.ok(waived.layers.has('L2'));
  assert.match(waived.waiver, /no e2e harness/);
  assert.strictEqual(parseLayerCell('needs L3').empty, true);

  const bad = checkClaimedVsReality(table([['AC-1', 'done', 'npm test exit 0', 'L9']]));
  assert.strictEqual(bad.ready, false);
  assert.ok(bad.problems.some((p) => p.includes('L9') && p.includes('FIX:')));
});

test('#110 crossComponent AC needs L3 evidence; non-cross AC is fine with L2', () => {
  const l2Only = table([
    ['AC-1: export writes file', 'export done', 'npm test exit 0; 4 passed', 'L2'],
    ['AC-2: pure formatter', 'formats', 'npm test exit 0; 2 passed', 'L2']
  ]);
  const status = checkClaimedVsReality(l2Only, { goal: crossGoal, tier: 'T1' });
  assert.strictEqual(status.ready, false);
  assert.strictEqual(status.problems.length, 1);
  assert.match(status.problems[0], /AC-1: needs L3 .*crossComponent/);
  assert.strictEqual(readyForDa(l2Only), true, 'without goal/tier only syntax is checked');

  const withL3 = l2Only.replace('npm test exit 0; 4 passed | L2', 'npm run e2e exit 0; 1 flow passed | L2+L3');
  assert.strictEqual(checkClaimedVsReality(withL3, { goal: crossGoal, tier: 'T1' }).ready, true);
});

test('#110 tier T2 requires L3 on every AC; waiver needs a concrete reason', () => {
  const goal = { acceptanceCriteria: [{ id: 'AC-1', statement: 'x' }] };
  const short = table([['AC-1', 'done', 'npm test exit 0', 'L2; L3 waived: n/a']]);
  const shortStatus = checkClaimedVsReality(short, { goal, tier: 'T2' });
  assert.strictEqual(shortStatus.ready, false);
  assert.ok(shortStatus.problems.some((p) => p.includes('waiver reason is too short')));
  const reasoned = table([['AC-1', 'done', 'npm test exit 0', 'L2; L3 waived: flow needs production payment provider']]);
  assert.strictEqual(checkClaimedVsReality(reasoned, { goal, tier: 'T2' }).ready, true);
  const legacy = '| AC | Claimed | Reality from command log |\n|---|---|---|\n| AC-1 | done | npm test exit 0 |\n';
  const legacyStatus = checkClaimedVsReality(legacy, { goal, tier: 'T2' });
  assert.strictEqual(legacyStatus.ready, false);
  assert.match(legacyStatus.problems[0], /no Layer column/);
});

test('#110 scaffold marks crossComponent rows "needs L3" and a hint row is not ready', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-claimed-reality-l3-'));
  createRun(root, { runId: 'run-l3', task: 'Exercise L3 hint' });
  const goalPath = path.join(root, '.ai-engineering-loop/runs/run-l3/goal-contract.json');
  fs.writeFileSync(goalPath, JSON.stringify({
    schemaVersion: 1,
    runId: 'run-l3',
    objective: 'Export across renderer and service.',
    acceptanceCriteria: [
      { id: 'AC-1', statement: 'export file', evidenceRequired: 'e2e', failureCases: ['path mismatch'], crossComponent: true },
      { id: 'AC-2', statement: 'format date', evidenceRequired: 'unit', failureCases: ['bad tz'] }
    ]
  }));
  transitionRun(root, 'run-l3', 'GOAL_FROZEN', {
    gate: 'goal',
    artifacts: {
      goalContract: {
        path: '.ai-engineering-loop/runs/run-l3/goal-contract.json',
        sha256: crypto.createHash('sha256').update(fs.readFileSync(goalPath)).digest('hex')
      }
    }
  });
  const result = createClaimedVsRealityTemplate(root, { runId: 'run-l3' });
  const markdown = fs.readFileSync(path.join(root, result.path), 'utf8');
  const rows = parseClaimedVsReality(markdown).rows;
  assert.strictEqual(rows[0].layer, 'needs L3');
  assert.strictEqual(rows[1].layer, undefined);
  assert.match(markdown, /L3 waived: <reason>/);
});

test('C-01 AC-1 an L3 tag needs a recorded e2e command or a cited manual flow', () => {
  const md = table([['AC-1', 'export works', 'npm test exit 0', 'L2+L3']]);
  const status = checkClaimedVsReality(md, { layers: new Set(['L2']) });
  assert.strictEqual(status.ready, false);
  assert.match(status.problems[0], /Layer says L3 but no e2e command was recorded.*FIX:/);
  assert.strictEqual(checkClaimedVsReality(md, { layers: new Set(['L2', 'L3']) }).ready, true);
  const manual = table([['AC-1', 'export works', 'manual flow: clicked Export, file at /tmp/a.csv', 'L2+L3']]);
  assert.strictEqual(checkClaimedVsReality(manual, { layers: new Set(['L2']) }).ready, true);
});

test('C-01 AC-2 an L1 tag needs a recorded L1 command; unknown layers skip the check', () => {
  const md = table([['AC-1', 'types ok', 'tsc exit 0', 'L1']]);
  assert.match(checkClaimedVsReality(md, { layers: new Set(['L2']) }).problems[0], /Layer says L1 but no L1 command/);
  assert.strictEqual(checkClaimedVsReality(md, { layers: null }).ready, true);
});

test('C-01 AC-3 a reasoned L3 waiver needs no recorded command', () => {
  const goal = { acceptanceCriteria: [{ id: 'AC-1', statement: 'x', crossComponent: true }] };
  const md = table([['AC-1', 'done', 'npm test exit 0', 'L2; L3 waived: flow needs production payment provider']]);
  assert.strictEqual(checkClaimedVsReality(md, { goal, tier: 'T1', layers: new Set(['L2']) }).ready, true);
});
