'use strict';

// C-16: what the reviewer saw is recorded and cannot change afterwards.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordReviewInputs, checkReviewInputs, loadReviewInputs } = require('../lib/review-ingest.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-inputs-'));
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'pack.md'), '# pack\n');
  fs.writeFileSync(path.join(runDir, 'diff.patch'), 'diff --git a/x b/x\n');
  return { root, runDir };
}

test('AC-1 review inputs record pack and diff hashes plus the DA prompt hash', () => {
  const { root } = fixture();
  const doc = recordReviewInputs(root, 'run-1', { packPath: '.ai-engineering-loop/runs/run-1/pack.md', diffPath: '.ai-engineering-loop/runs/run-1/diff.patch' });
  assert.strictEqual(doc.inputs.length, 2);
  assert.match(doc.inputs[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(doc.promptSha256, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(loadReviewInputs(root, 'run-1').inputs, doc.inputs);
});

test('AC-2 changing the pack after the reviewer saw it breaks the binding', () => {
  const { root, runDir } = fixture();
  const doc = recordReviewInputs(root, 'run-1', { packPath: '.ai-engineering-loop/runs/run-1/pack.md' });
  const ledger = { reviewer: { inputs: doc.inputs } };
  assert.deepStrictEqual(checkReviewInputs(root, ledger), []);
  fs.appendFileSync(path.join(runDir, 'pack.md'), 'edited later\n');
  assert.match(checkReviewInputs(root, ledger)[0], /pack\.md changed after the reviewer saw it/);
  assert.deepStrictEqual(checkReviewInputs(root, { reviewer: {} }), [], 'legacy ledgers without inputs still pass');
});
