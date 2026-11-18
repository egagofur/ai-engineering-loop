'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { promoteLearning, loadRules } = require('../lib/rules.js');

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rule-proof-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.mkdirSync(path.join(root, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'learnings.json'), JSON.stringify({ schemaVersion: 1, entries: [
    { id: 'L-1', lesson: 'no console.log in src', runIds: ['a', 'b', 'c'] },
    { id: 'L-2', lesson: 'no TODO file', runIds: ['a', 'b', 'c'] }
  ] }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'module.exports = 1;\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'clean');
  const clean = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'console.log("debug");\nmodule.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'TODO'), 'later\n');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'bad');
  const bad = git('rev-parse', 'HEAD');
  return { root, clean, bad };
}

test('C-31 a forbid rule is promoted only when it catches the past mistake, and records the proof', () => {
  const { root, clean, bad } = repo();
  assert.throws(() => promoteLearning(root, 'L-1', { forbidApi: 'console\\.log', fix: 'use the logger', by: 'ega', prove: clean }), /did not fail on/);
  const rule = promoteLearning(root, 'L-1', { forbidApi: 'console\\.log', fix: 'use the logger', by: 'ega', prove: bad });
  assert.strictEqual(rule.provenBy.commit, bad);
  assert.strictEqual(loadRules(root).rules[0].provenBy.commit, bad);
});

test('C-31 a repo-scope rule is proven against the tree of that commit', () => {
  const { root, clean, bad } = repo();
  const check = `${JSON.stringify(process.execPath)} -e "process.exit(require('fs').existsSync('TODO') ? 1 : 0)"`;
  assert.throws(() => promoteLearning(root, 'L-2', { check, fix: 'delete TODO', by: 'ega', prove: clean }), /did not fail on/);
  const rule = promoteLearning(root, 'L-2', { check, fix: 'delete TODO', by: 'ega', prove: bad });
  assert.strictEqual(rule.provenBy.commit, bad);
  assert.strictEqual(execFileSync('git', ['worktree', 'list'], { cwd: root, encoding: 'utf8' }).trim().split('\n').length, 1, 'temporary worktree removed');
});
