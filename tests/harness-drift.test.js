'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { auditHarness } = require('../lib/harness-audit.js');
const { formalCoveredFiles } = require('../lib/verification-lanes.js');

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-drift-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'pay'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'pay', 'refund.js'), 'module.exports = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}

test('C-34 doctor --harness flags feature-map paths that match no tracked file', () => {
  const root = repo();
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'feature-map.md'), '| Feature | Where | Paths | How to reach | Driver |\n|---|---|---|---|---|\n| refund | Orders | src/pay/** | open order | |\n| export | Reports | src/export/** | click Export | |\n');
  const items = auditHarness(root, { budget: false }).items.filter((item) => item.id === 'feature-map-drift');
  assert.strictEqual(items.length, 1);
  assert.match(items[0].detail, /"export".*src\/export\/\*\*/);
});

test('C-31 doctor --harness lists rules never shown to catch a real mistake', () => {
  const root = repo();
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'rules.json'), JSON.stringify({ schemaVersion: 1, rules: [
    { id: 'R-1', from: 'L-1', why: 'w', fix: 'f', check: 'true', createdAt: new Date().toISOString() },
    { id: 'R-2', from: 'L-2', why: 'w', fix: 'f', check: 'true', createdAt: new Date().toISOString(), provenBy: { commit: 'abc', at: 'now' } }
  ] }));
  const unproven = auditHarness(root, { budget: false }).items.filter((item) => item.id === 'rule-unproven');
  assert.deepStrictEqual(unproven.map((item) => item.detail.split(' ')[0]), ['R-1']);
});

test('C-35 formal_covers names the code whose change requires the formal check', () => {
  const root = repo();
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'verification.md'), '- **formal**: `sh scripts/formal.sh`\n- **formal_covers**: src/pay/**, src/ledger/**\n');
  fs.writeFileSync(path.join(root, 'diff.patch'), 'diff --git a/src/pay/refund.js b/src/pay/refund.js\n--- a/src/pay/refund.js\n+++ b/src/pay/refund.js\n@@ -1 +1 @@\n-module.exports = 1;\n+module.exports = 2;\n');
  const run = { artifacts: { diff: { path: 'diff.patch' } } };
  assert.deepStrictEqual(formalCoveredFiles(root, run), ['src/pay/refund.js']);
  fs.writeFileSync(path.join(root, 'diff.patch'), 'diff --git a/src/ui.js b/src/ui.js\n--- a/src/ui.js\n+++ b/src/ui.js\n@@ -1 +1 @@\n-a\n+b\n');
  assert.deepStrictEqual(formalCoveredFiles(root, run), []);
});
