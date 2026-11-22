'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRun, runsDir } = require('../lib/run-state.js');
const { readDoc } = require('../lib/docs.js');
const { recordSpike, showSpike } = require('../lib/spike.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-spike-'));
  fs.mkdirSync(path.join(dir, '.ai-engineering-loop'), { recursive: true });
  return dir;
}

test('docs prototype-spike is a throwaway flow and forbids an arena', () => {
  const doc = readDoc('prototype-spike');
  assert.strictEqual(doc.rel, 'core/prototype-spike.md');
  for (const word of ['--discarded', 'before the Goal is frozen', 'Delete the scratch', '/arena', 'tournament', 'second model']) {
    assert.ok(doc.text.includes(word), word);
  }
});

test('record requires a discarded spike and refuses a frozen Goal', () => {
  const dir = project();
  const run = createRun(dir, { task: 'Paginate the list' });
  assert.throws(() => recordSpike(dir, { question: 'Does slice already paginate?', learned: 'It takes a fixed length.', discarded: false }), /--discarded/);
  const saved = recordSpike(dir, {
    question: 'Does slice already paginate?',
    learned: 'It takes a fixed length. The contract needs a page argument.',
    discarded: true
  });
  assert.strictEqual(saved.discarded, true);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(runsDir(dir), run.runId, 'spike.json'), 'utf8'))).sort(), ['discarded', 'learned', 'question', 'recordedAt', 'runId', 'schemaVersion']);
  const statePath = path.join(runsDir(dir), run.runId, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.state = 'GOAL_FROZEN';
  state.goal = { frozen: true, version: 1 };
  fs.writeFileSync(statePath, JSON.stringify(state));
  assert.throws(() => recordSpike(dir, { question: 'Does slice already paginate?', learned: 'Too late to change the contract.', discarded: true }), (err) => err.code === 'GOAL_ALREADY_FROZEN');
});

test('show is optional when no spike was recorded, and fails a hand-edit that keeps the prototype', () => {
  const dir = project();
  assert.strictEqual(showSpike(dir).recorded, false);
  const run = createRun(dir, { task: 'Paginate the list' });
  assert.strictEqual(showSpike(dir).ok, true);
  assert.strictEqual(showSpike(dir).recorded, false);
  fs.writeFileSync(path.join(runsDir(dir), run.runId, 'spike.json'), JSON.stringify({ schemaVersion: 1, discarded: false, question: 'kept', learned: 'the code' }));
  const bad = showSpike(dir);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.code, 'SPIKE_NOT_DISCARDED');
});

test('the CLI records the note and does not write product files', () => {
  const dir = project();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-spike-home-'));
  createRun(dir, { task: 'Paginate the list' });
  const before = fs.readdirSync(dir);
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
  const refused = cli('spike', 'record', '--question', 'Does slice already paginate?', '--learned', 'It takes a fixed length.', '--json');
  assert.strictEqual(refused.status, 1);
  assert.strictEqual(JSON.parse(refused.stdout).code, 'SPIKE_NOT_DISCARDED');
  const saved = cli('spike', 'record', '--discarded', '--question', 'Does slice already paginate?', '--learned', 'It takes a fixed length. The contract needs a page argument.', '--json');
  assert.strictEqual(saved.status, 0, saved.stdout + saved.stderr);
  assert.strictEqual(JSON.parse(saved.stdout).discarded, true);
  assert.deepStrictEqual(fs.readdirSync(dir), before);
  const shown = JSON.parse(cli('spike', 'show', '--json').stdout);
  assert.strictEqual(shown.ok, true);
  assert.strictEqual(shown.recorded, true);
  const unknown = cli('spike', 'record', '--arena', '--json');
  assert.strictEqual(unknown.status, 2);
  assert.match(unknown.stdout + unknown.stderr, /Nothing was written/);
});
