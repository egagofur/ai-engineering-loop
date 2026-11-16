'use strict';

// C-06: clean state at delivery.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkCleanState } = require('../lib/clean-state.js');

function repoWithDiff(diffText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-clean-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const runDir = path.join(root, '.ai-engineering-loop', 'runs', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'diff.patch'), diffText);
  const run = { runId: 'run-1', artifacts: { diff: { path: '.ai-engineering-loop/runs/run-1/diff.patch' } } };
  return { root, runDir, run };
}

const added = (file, lines, created = false) =>
  `diff --git a/${file} b/${file}\n${created ? 'new file mode 100644\n' : ''}--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;

test('AC-3 a debugger statement or conflict marker in the change blocks delivery with file:line', () => {
  const { root, run } = repoWithDiff(added('src/a.js', ['const a = 1;', '  debugger;', '<<<<<<< HEAD']));
  const { errors } = checkCleanState(root, run);
  assert.strictEqual(errors.length, 2);
  assert.match(errors[0], /^src\/a\.js:2: debugger statement.*FIX:/);
  assert.match(errors[1], /src\/a\.js:3: merge conflict marker/);
});

test('a committed .env is blocked, an .env.example is not', () => {
  const leak = repoWithDiff(added('.env', ['TOKEN=x'], true));
  assert.strictEqual(checkCleanState(leak.root, leak.run).errors.length, 1);
  const ok = repoWithDiff(added('.env.example', ['TOKEN='], true));
  assert.strictEqual(checkCleanState(ok.root, ok.run).errors.length, 0);
});

test('AC-2 a leftover _templateOnly artifact blocks delivery', () => {
  const { root, runDir, run } = repoWithDiff(added('src/a.js', ['x']));
  fs.writeFileSync(path.join(runDir, 'delivery-draft.json'), JSON.stringify({ _templateOnly: true }));
  assert.match(checkCleanState(root, run).errors[0], /_templateOnly scaffold/);
});

test('AC-1 untracked files outside the reviewed change warn in ASSISTED and block in UNATTENDED', () => {
  const { root, run } = repoWithDiff(added('src/a.js', ['x'], true));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'x\n');
  fs.writeFileSync(path.join(root, 'debug-output.log'), 'noise\n');
  const assisted = checkCleanState(root, run, { mode: 'ASSISTED' });
  assert.strictEqual(assisted.errors.length, 0);
  assert.match(assisted.warnings[0], /debug-output\.log/);
  assert.doesNotMatch(assisted.warnings[0], /src\/a\.js/);
  const unattended = checkCleanState(root, run, { mode: 'UNATTENDED' });
  assert.match(unattended.errors[0], /untracked file\(s\) not part of the reviewed change.*FIX:/);
});
