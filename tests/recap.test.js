'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { collectRecap, cleanTitle } = require('../lib/recap.js');
const { renderRecap } = require('../lib/recap-html.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const NOW = new Date('2026-11-17T12:00:00Z');

function writeRun(project, runId, { delivered = true, goal = {}, verdict = 'PASS', iterations = ['PASS'], tier = 'T1', commands = [{ command: 'npm test', exitCode: 0, durationMs: 4200, stdout: 'SECRET-LOG' }], displayName } = {}) {
  const dir = path.join(project, '.ai-engineering-loop', 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  const t = (h) => new Date(Date.parse(`${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T00:00:00Z`) + h * 3600000).toISOString();
  const history = [
    { to: 'STARTED', at: t(1) }, { to: 'GOAL_FROZEN', at: t(1.5) }, { to: 'MAKER_COMPLETE', at: t(3) },
    { to: 'VERIFIED', at: t(3.25) }, { to: verdict === 'PASS' ? 'JUDGED_PASS' : 'JUDGED_ITERATE', at: t(3.5) },
    ...(delivered ? [{ to: 'DELIVERED', at: t(4) }] : [])
  ];
  const json = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
  json('state.json', { runId, state: delivered ? 'DELIVERED' : 'VERIFIED', tier: { current: tier }, displayName: displayName || `--task ${goal.objective || 'Thing'}`, history });
  json('goal-contract.json', { objective: 'Add export. It writes CSV.', acceptanceCriteria: [{ id: 'AC-1', statement: 'exports rows' }], ...goal });
  json('verdict.json', { verdict, reason: 'all green', tier });
  json('verification.json', { commands });
  if (delivered) json('delivery.json', { destination: 'feat/export', approvedBy: 'ega' });
  json('receipt.json', { acceptanceCriteria: [{ id: 'AC-1', statement: 'exports rows', status: 'PASS', evidence: 'npm test exit 0' }], impact: { outOfMap: ['src/other.js'] } });
  fs.writeFileSync(path.join(dir, 'iterations.jsonl'), iterations.map((v, i) => JSON.stringify({ iteration: i + 1, verdict: v, cause: v === 'PASS' ? undefined : 'missing-test' })).join('\n'));
}

function project(name = 'shop') {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-recap-')), name);
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'runs'), { recursive: true });
  return root;
}

test('C-28 collects only runs inside the window and splits cycle time by stage', () => {
  const p = project();
  writeRun(p, '20261116T010000Z-aaaa1111');
  writeRun(p, '20261112T010000Z-bbbb2222', { delivered: false, verdict: 'ITERATE', iterations: ['ITERATE'] });
  writeRun(p, '20261101T010000Z-cccc3333');
  const data = collectRecap({ projects: [p], days: 7, now: NOW });
  assert.deepStrictEqual(data.runs.map((r) => r.runId), ['20261112T010000Z-bbbb2222', '20261116T010000Z-aaaa1111']);
  const run = data.runs[1];
  assert.deepStrictEqual(run.stages, { goal: 1800000, maker: 5400000, verify: 900000, review: 900000, deliver: 1800000 });
  assert.strictEqual(data.metrics.delivered, 1);
  assert.strictEqual(data.metrics.firstPassRate, 50);
  assert.deepStrictEqual(data.metrics.causes, { 'missing-test': 1 });
  assert.strictEqual(data.previous, null);
  assert.strictEqual(run.commands[0].stdout, undefined);
});

test('C-28 previous window metrics appear only when it has runs', () => {
  const p = project();
  writeRun(p, '20261116T010000Z-aaaa1111');
  writeRun(p, '20261106T010000Z-dddd4444');
  const data = collectRecap({ projects: [p], days: 7, now: NOW });
  assert.strictEqual(data.previous.runs, 1);
});

test('C-28 titles and client text come from the Goal, never invented', () => {
  assert.strictEqual(cleanTitle({ displayName: '--task Validate qty' }, {}), 'Validate qty');
  assert.strictEqual(cleanTitle({}, { title: 'Export CSV', objective: 'x' }), 'Export CSV');
  assert.strictEqual(cleanTitle({}, { objective: 'Add export. It writes CSV.' }), 'Add export');
  assert.strictEqual(cleanTitle({ displayName: '--list' }, {}), 'Untitled run');
  const p = project();
  writeRun(p, '20261116T010000Z-aaaa1111', { goal: { plainSummary: 'You can export reports.', businessOutcome: 'b' } });
  writeRun(p, '20261115T010000Z-eeee5555', { goal: { businessOutcome: 'Finance can download data.' } });
  writeRun(p, '20261114T010000Z-ffff6666');
  const runs = collectRecap({ projects: [p], days: 7, now: NOW }).runs;
  assert.deepStrictEqual(runs.map((r) => r.clientTextSource), ['objective', 'businessOutcome', 'plainSummary']);
});

test('C-28 an empty window renders an empty state', () => {
  const html = renderRecap(collectRecap({ projects: [project()], days: 3, now: NOW }), { audience: 'me', now: NOW });
  assert.match(html, /No runs in this period/);
});

test('C-28 the client view carries no paths, commands, logs or findings', () => {
  const p = project();
  writeRun(p, '20261116T010000Z-aaaa1111', { goal: { businessOutcome: 'Finance can <b>download</b> data.' } });
  const html = renderRecap(collectRecap({ projects: [p], days: 7, now: NOW }), { audience: 'client', now: NOW });
  const client = html.slice(html.indexOf('id="client"'), html.indexOf('</section>', html.indexOf('id="client"')));
  assert.ok(client.length > 100);
  for (const leak of ['file://', 'npm test', 'src/other.js', 'SECRET-LOG', 'T1', 'feat/export', p]) assert.ok(!client.includes(leak), leak);
  assert.ok(client.includes('Finance can &lt;b&gt;download&lt;/b&gt; data.'));
  assert.ok(!html.includes('SECRET-LOG'));
  assert.match(html, /aria-selected="true"[^>]*data-view="client"|data-view="client"[^>]*aria-selected="true"/);
});

test('C-28 recap CLI writes the page, refuses multi-project client recaps and bad days', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-recap-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-recap-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  assert.strictEqual(cli('init').status, 0);
  writeRun(repo, '20261116T010000Z-aaaa1111');
  const ok = cli('recap', '--days', '7', '--for', 'lead', '--json', '--now', NOW.toISOString());
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  const out = JSON.parse(ok.stdout);
  assert.match(out.path, /\.ai-engineering-loop[\\/]recaps[\\/]recap-2026-11-10-2026-11-17-lead\.html$/);
  assert.strictEqual(out.runs, 1);
  assert.ok(fs.existsSync(out.path));
  const other = project();
  const multi = cli('recap', '--for', 'client', '--projects', `${repo},${other}`);
  assert.notStrictEqual(multi.status, 0);
  assert.match(multi.stdout + multi.stderr, /one project/);
  const bad = cli('recap', '--days', '0');
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stdout + bad.stderr, /--days/);
  const unknown = cli('recap', '--bogus');
  assert.notStrictEqual(unknown.status, 0);
});
