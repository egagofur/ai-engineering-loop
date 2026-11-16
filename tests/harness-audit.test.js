'use strict';

// C-08: harness debt audit and bench ablation guard.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { auditHarness, structuredText } = require('../lib/harness-audit.js');
const { ablated, validateComponents, writeMarker } = require('../lib/ablation.js');

test('structuredText ignores keywords sprinkled in prose (anti-gaming)', () => {
  const md = 'We test and verify everything and the definition of done is clear.\n\n## Verification\n- npm test\n';
  const text = structuredText(md);
  assert.match(text, /## verification/);
  assert.doesNotMatch(text, /definition of done/);
});

test('AC-1 audit flags a bloated or unstructured entry file and stale learnings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-audit-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), `${'filler line\n'.repeat(250)}The definition of done is tests pass.\n`);
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'runs'), { recursive: true });
  for (let i = 0; i < 12; i += 1) fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'runs', `run-${String(i).padStart(3, '0')}`));
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'learnings.json'), JSON.stringify({ entries: [
    { id: 'L-old', lesson: 'old lesson', runIds: ['run-000'] },
    { id: 'L-new', lesson: 'fresh', runIds: ['run-011'] }
  ] }));
  const audit = auditHarness(root, { budget: false });
  assert.strictEqual(audit.ok, false);
  const ids = audit.items.map((item) => item.id);
  assert.ok(ids.includes('entry-file-size'));
  assert.ok(audit.items.some((item) => item.id === 'entry-file-structure' && /definition of done/.test(item.detail)));
  assert.ok(audit.items.some((item) => item.id === 'stale-learning' && item.detail.startsWith('L-old')));
  assert.ok(!audit.items.some((item) => item.detail.startsWith('L-new')));
});

test('AC-1 inside the AEL repo the audit reports skill-budget headroom', () => {
  const audit = auditHarness(path.join(__dirname, '..'), { budget: true });
  const budget = audit.items.find((item) => item.id === 'skill-budget');
  assert.ok(budget, 'budget item present');
  assert.match(budget.detail, /T1 skill context \d+\/\d+/);
});

test('ablation is honoured only inside a bench repo with a matching marker, and is logged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-ablate-'));
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'runs', 'run-1'), { recursive: true });
  const env = { AEL_BENCH_MODE: 'ASSISTED', AEL_ABLATE: 'integrity' };
  assert.strictEqual(ablated(root, 'integrity', 'run-1', env), false, 'no marker: env alone cannot disable a gate');
  writeMarker(root, ['integrity']);
  assert.strictEqual(ablated(root, 'integrity', 'run-1', { AEL_ABLATE: 'integrity' }), false, 'outside bench mode');
  assert.strictEqual(ablated(root, 'l3', 'run-1', env), false);
  assert.strictEqual(ablated(root, 'integrity', 'run-1', env), true);
  assert.match(fs.readFileSync(path.join(root, '.ai-engineering-loop/runs/run-1/ablation.log'), 'utf8'), /integrity/);
  assert.throws(() => validateComponents(['verification']), /Unknown --without/);
});
