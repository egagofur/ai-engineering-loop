'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { checkProvenance } = require('../lib/provenance.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const FAKE_GH = path.join(__dirname, 'fixtures', 'fake-gh-auth.js');

function repo({ ghOk = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-dig-home-'));
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-dig-')));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p","scripts":{"test":"node -e 0"}}\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), Array.from({ length: 10 }, (_, i) => `const v${i} = ${i};`).join('\n'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { 'mattermost-agent': { command: 'npx' } } }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1', AEL_GH_BIN: FAKE_GH, AEL_GLAB_BIN: 'ael-no-such-glab', FAKE_GH_AUTH: ghOk ? '0' : '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8', input: '' });
  return { dir, home, cli, git };
}

const json = (result) => {
  const text = String(result.stdout);
  return JSON.parse(text.slice(text.search(/^\{/m)));
};

test('C-45 init writes sources.md from what this machine has, and keeps the human Scope section on refresh', () => {
  const { dir, cli } = repo();
  assert.strictEqual(cli('init').status, 0);
  const file = path.join(dir, '.ai-engineering-loop', 'sources.md');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /\| github \| yes \|/);
  assert.match(text, /\| gitlab \| no \| .*glab not installed/);
  assert.match(text, /\| mattermost \| yes \| .*read-only/i);
  assert.match(text, /never post/);
  assert.doesNotMatch(text, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/'));
  fs.writeFileSync(file, text.replace(/- Mattermost channels: .*/, '- Mattermost channels: town-square, dev'));
  assert.strictEqual(cli('sources', 'refresh').status, 0);
  assert.match(fs.readFileSync(file, 'utf8'), /Mattermost channels: town-square, dev/);
});

test('C-45 a machine without gh still works: the source is listed as unavailable and nothing fails', () => {
  const { cli } = repo({ ghOk: false });
  assert.strictEqual(cli('init').status, 0);
  const out = json(cli('sources', 'show', '--json'));
  const github = out.sources.find((item) => item.id === 'github');
  assert.strictEqual(github.available, false);
  assert.match(github.detail, /not logged in/);
});

test('C-45 the T1 gather budget refuses a fifth query with why and fix; entries are redacted', () => {
  const { dir, cli } = repo();
  assert.strictEqual(cli('init').status, 0);
  const run = json(cli('run', '--json', '--tier', 'T1', '--tier-reason', 'test', 'Add export filters to the report page'));
  for (let i = 1; i <= 4; i += 1) {
    const recorded = cli('sources', 'record', '--run', run.runId, '--source', 'github', '--ref', `https://github.com/o/r/issues/${i}`, '--line', `issue ${i} token sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd`, '--json');
    assert.strictEqual(recorded.status, 0, recorded.stdout + recorded.stderr);
  }
  const refused = cli('sources', 'record', '--run', run.runId, '--source', 'github', '--ref', 'https://github.com/o/r/issues/5', '--line', 'five', '--json');
  assert.notStrictEqual(refused.status, 0);
  const error = json(refused);
  assert.strictEqual(error.code, 'GATHER_BUDGET');
  assert.ok(error.why && error.fix);
  const saved = fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'runs', run.runId, 'sources.json'), 'utf8');
  assert.ok(!saved.includes('sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd'));
  const hint = json(cli('sources', 'hint', '--run', run.runId, '--json'));
  assert.strictEqual(hint.used, 4);
  assert.ok(hint.hints.some((item) => item.source === 'github' && /gh issue list --search "export"/.test(item.try)));
  assert.ok(!hint.hints.some((item) => /post|create|send/i.test(item.try.replace(/never post/, ''))), 'no write tools suggested');
  assert.strictEqual(cli('budget', 'record', '--run', run.runId, '--role', 'gather', '--input', '10', '--output', '5', '--model', 'm', '--json').status, 0);
});

test('C-46 facts need a checkable source; the rest are downgraded, shown and never block', () => {
  const { dir, cli, git } = repo();
  assert.strictEqual(cli('init').status, 0);
  const run = json(cli('run', '--json', 'Add export filters'));
  const sha = git('rev-parse', 'HEAD');
  cli('sources', 'record', '--run', run.runId, '--source', 'github', '--ref', 'https://github.com/o/r/issues/7', '--line', 'filters must persist');
  const statements = [
    { text: 'Values live in src/a.js', kind: 'fact', source: 'src/a.js:3' },
    { text: 'Line 999 explains it', kind: 'fact', source: 'src/a.js:999' },
    { text: 'Introduced at init', kind: 'fact', source: sha.slice(0, 12) },
    { text: 'Issue asks for persistence', kind: 'fact', source: 'S-1' },
    { text: 'Unrecorded URL', kind: 'fact', source: 'https://example.com/x' },
    { text: 'Use CSV not XLSX', kind: 'decision', by: 'ega' },
    { text: 'Nobody exports more than 10k rows', kind: 'assumption' }
  ];
  const result = checkProvenance(dir, run.runId, { statements });
  assert.deepStrictEqual(result.statements.map((item) => item.kind), ['fact', 'assumption', 'fact', 'fact', 'assumption', 'decision', 'assumption']);
  assert.match(result.statements[1].reason, /has 10 line\(s\), not 999/);
  assert.strictEqual(result.unconfirmed.length, 3);

  const goal = { schemaVersion: 1, runId: run.runId, objective: 'Add export filters', acceptanceCriteria: [{ id: 'AC-1', statement: 's', evidenceRequired: 'e', failureCases: ['f'] }], statements };
  fs.writeFileSync(path.join(dir, '.ai-engineering-loop', 'runs', run.runId, 'goal-contract.json'), JSON.stringify(goal));
  const gate = cli('gate', 'goal', '--run', run.runId, '--json');
  assert.strictEqual(gate.status, 0, gate.stdout + gate.stderr);
  const status = cli('status');
  assert.match(status.stdout + status.stderr, /Unconfirmed: 3 assumption\(s\) in the Goal \(not blocking\)/);
  const bad = { ...goal, statements: [{ text: 'x', kind: 'rumour' }] };
  assert.match(require('../lib/gates.js').validateGoalContract(bad).errors.join(), /kind must be fact, decision, assumption/);
});
