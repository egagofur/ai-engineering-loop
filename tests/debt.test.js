'use strict';

// C-14: accepted trade-offs and L3 waivers become durable debt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordRunDebt, openDebtFor, loadDebt, closeDebt } = require('../lib/debt.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-debt-'));
  const dir = path.join(root, '.ai-engineering-loop', 'runs', 'run-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify({ findings: [
    { id: 'F-1', location: 'src/list.js:12', failureScenario: 'N+1 query on large pages', severity: 'MEDIUM', validity: 'VALID', axis: 'spec' },
    { id: 'F-2', location: 'src/list.js:3', failureScenario: 'naming', severity: 'LOW', validity: 'INVALID' },
    { id: 'F-3', location: 'src/a.js', failureScenario: 'crash', severity: 'BLOCKER', validity: 'VALID' }
  ] }));
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'tasks', 'claimed-vs-reality.md'),
    '| AC | Claimed | Reality from command log | Layer |\n|---|---|---|---|\n| AC-1 | export | npm test exit 0 | L2; L3 waived: no e2e harness for the desktop shell yet |\n');
  return root;
}

test('AC-1 delivery records accepted VALID MEDIUM/LOW findings and L3 waivers, once', () => {
  const root = fixture();
  assert.strictEqual(recordRunDebt(root, 'run-1').added, 2);
  assert.strictEqual(recordRunDebt(root, 'run-1').added, 0, 'idempotent');
  const items = loadDebt(root).items;
  assert.deepStrictEqual(items.map((i) => i.kind), ['accepted-finding', 'l3-waiver']);
  assert.strictEqual(items[0].file, 'src/list.js');
  assert.match(items[1].whyDeferred, /no e2e harness/);
});

test('AC-2 open debt is found for the files a new change touches, and can be closed by a human', () => {
  const root = fixture();
  recordRunDebt(root, 'run-1');
  assert.deepStrictEqual(openDebtFor(root, ['src/list.js']).map((i) => i.id), ['run-1:F-1']);
  assert.strictEqual(openDebtFor(root, ['src/other.js']).length, 0);
  assert.throws(() => closeDebt(root, 'run-1:F-1', {}), /--by/);
  closeDebt(root, 'run-1:F-1', { by: 'ega', note: 'fixed in #120' });
  assert.strictEqual(openDebtFor(root, ['src/list.js']).length, 0);
});
