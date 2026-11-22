'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { parseFreezeDiagramLine } = require('../lib/generate-workflow.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function setup(goalExtra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-diagram-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-diagram-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  execFileSync('git', ['init', '-q'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'index.js'), 'module.exports = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: repo });
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  const run = JSON.parse(cli('run', '--json', 'Cancel orders').stdout);
  const draft = {
    schemaVersion: 1,
    runId: run.runId,
    objective: 'Cancel orders',
    restatement: { problem: 'A paid order cannot be cancelled.', doneWhen: 'Cancel moves a paid order to Cancelled.', failIf: 'A shipped order can still be cancelled.', unknowns: 'None.' },
    acceptanceCriteria: [{ id: 'AC-1', statement: 'cancel works', evidenceRequired: 'test', failureCases: ['shipped order cancels'] }],
    flowSubject: 'order',
    flow: [
      { from: 'Paid', event: 'cancel', to: 'Cancelled', effects: [{ text: 'refund', ac: 'AC-1' }, { text: 'points?' }] },
      { from: 'Paid', event: 'ship', to: 'Shipped' }
    ],
    ...goalExtra
  };
  fs.writeFileSync(path.join(repo, 'draft.json'), JSON.stringify(draft));
  const runDir = path.join(repo, '.ai-engineering-loop', 'runs', run.runId);
  return { repo, cli, runId: run.runId, runDir };
}

test('C-27 goal draft returns diagram options and counts without writing any diagram', () => {
  const { cli, runId, runDir } = setup();
  const result = cli('goal', 'draft', '--json', '--run', runId, '--file', 'draft.json', '--revision', '0');
  assert.strictEqual(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.diagramOptions[0].view, 'state');
  assert.strictEqual(out.diagramOptions[0].recommended, true);
  assert.deepStrictEqual({ undecided: out.flow.undecided, hotspots: out.flow.hotspots, sideEffects: out.flow.sideEffects }, { undecided: 0, hotspots: 0, sideEffects: 1 });
  assert.ok(!fs.existsSync(path.join(runDir, 'diagrams')));
});

test('C-27 goal diagram writes only the chosen view and leaves the Run state alone', () => {
  const { cli, runId, runDir } = setup();
  assert.strictEqual(cli('goal', 'draft', '--json', '--run', runId, '--file', 'draft.json', '--revision', '0').status, 0);
  const before = fs.readFileSync(path.join(runDir, 'state.json'), 'utf8');
  const result = cli('goal', 'diagram', '--run', runId, '--view', 'lanes');
  assert.strictEqual(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.strictEqual(out.view, 'lanes');
  assert.deepStrictEqual(fs.readdirSync(path.join(runDir, 'diagrams')), ['lanes-r1.html']);
  assert.match(fs.readFileSync(out.path, 'utf8'), /Actor lanes/);
  assert.strictEqual(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'), before);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(out.path).mode & 0o777, 0o600);
});

test('C-27 goal diagram refuses a stale revision, a missing view and a Goal without flow', () => {
  const { cli, runId } = setup();
  assert.strictEqual(cli('goal', 'draft', '--json', '--run', runId, '--file', 'draft.json', '--revision', '0').status, 0);
  const stale = cli('goal', 'diagram', '--run', runId, '--view', 'state', '--revision', '7');
  assert.notStrictEqual(stale.status, 0);
  assert.match(stale.stdout + stale.stderr, /revision 1/);
  const noView = cli('goal', 'diagram', '--run', runId);
  assert.notStrictEqual(noView.status, 0);
  assert.match(noView.stdout + noView.stderr, /--view state\|storyboard\|lanes/);
  const plain = setup({ flow: undefined, flowSubject: undefined });
  assert.strictEqual(plain.cli('goal', 'draft', '--json', '--run', plain.runId, '--file', 'draft.json', '--revision', '0').status, 0);
  const noFlow = plain.cli('goal', 'diagram', '--run', plain.runId, '--view', 'state');
  assert.notStrictEqual(noFlow.status, 0);
  assert.match(noFlow.stdout + noFlow.stderr, /no flow/);
});

test('C-27 after freeze the diagram is drawn from the frozen contract', () => {
  const { cli, runId, runDir } = setup();
  assert.strictEqual(cli('goal', 'draft', '--json', '--run', runId, '--file', 'draft.json', '--revision', '0').status, 0);
  assert.strictEqual(cli('goal', 'freeze', '--json', '--latest', '--run', runId, '--by', 'human').status, 0);
  const result = cli('goal', 'diagram', '--run', runId, '--view', 'state');
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(runDir, 'diagrams', 'state-frozen.html')));
});

test('C-27 freeze_diagram in workflow.md shapes the options', () => {
  assert.strictEqual(parseFreezeDiagramLine('- **freeze_diagram**: off'), 'off');
  assert.strictEqual(parseFreezeDiagramLine('- **freeze_diagram**: lanes'), 'lanes');
  assert.strictEqual(parseFreezeDiagramLine('- **freeze_diagram**: pie'), 'auto');
  assert.strictEqual(parseFreezeDiagramLine('nothing here'), 'auto');
  const { repo, cli, runId } = setup();
  fs.appendFileSync(path.join(repo, '.ai-engineering-loop', 'workflow.md'), '\n- **freeze_diagram**: off\n');
  const out = JSON.parse(cli('goal', 'draft', '--json', '--run', runId, '--file', 'draft.json', '--revision', '0').stdout);
  assert.deepStrictEqual(out.diagramOptions, []);
  assert.strictEqual(out.diagramsOff, true);
});
