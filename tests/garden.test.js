'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { createRun, runsDir } = require('../lib/run-state.js');
const { readDoc } = require('../lib/docs.js');
const { planGarden } = require('../lib/garden.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const MAP = `| Feature | Where (UI or endpoint) | Paths | How to reach | Driver |
|---|---|---|---|---|
| live | page | src/list.js | open | |
| dead | page | src/missing/** | open | |
| mixed | page | src/list.js, src/missing/** | open | |
`;

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-garden-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/list.js'), 'module.exports = 1;\n');
  execFileSync('git', ['add', 'src/list.js'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.ai-engineering-loop'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ai-engineering-loop', 'architecture.md'), 'USER NOTES\n');
  fs.writeFileSync(path.join(dir, '.ai-engineering-loop', 'feature-map.md'), MAP);
  const live = createRun(dir, { task: 'Keep me', now: new Date('2026-11-01T00:00:00.000Z') });
  const old = createRun(dir, { task: 'Old delivery', now: new Date('2026-09-01T00:00:00.000Z') });
  const idle = createRun(dir, { task: 'Left open', now: new Date('2026-11-01T00:00:00.000Z') });
  const patch = (run, extra) => {
    const file = path.join(runsDir(dir), run.runId, 'state.json');
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...extra }));
  };
  patch(old, { state: 'DELIVERED', updatedAt: '2026-09-01T00:00:00.000Z' });
  patch(idle, { state: 'STARTED', updatedAt: '2026-11-01T00:00:00.000Z' });
  fs.writeFileSync(path.join(dir, '.ai-engineering-loop', 'learnings.json'), JSON.stringify({
    schemaVersion: 1,
    generator: 'ael-learn-v1',
    sourceRuns: 1,
    entries: [
      { id: 'L-dead', axis: 'spec', severity: 'LOW', lesson: 'The gone file still matters.', locations: ['src/gone.js'], occurrences: 1, runIds: [live.runId], firstRunId: live.runId, lastRunId: live.runId, lastSeenAt: '' },
      { id: 'L-live', axis: 'spec', severity: 'LOW', lesson: 'The list file still matters.', locations: ['src/list.js'], occurrences: 1, runIds: [live.runId], firstRunId: live.runId, lastRunId: live.runId, lastSeenAt: '' }
    ],
    suppressed: []
  }));
  return { dir, old, idle };
}

function cli(dir, ...args) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-garden-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_SETUP_HINT: '1', AEL_NO_AUTO_UPDATE: '1' };
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
}

test('docs garden says dry-run is the default and Runs are kept', () => {
  const doc = readDoc('garden');
  assert.strictEqual(doc.rel, 'core/garden.md');
  for (const word of ['--garden', '--yes', 'never deletes a Run', '## Stale (garden)', 'feature-map.md.ael-backup']) {
    assert.ok(doc.text.includes(word), word);
  }
});

test('refresh --garden reports the tidy and writes nothing until --yes', () => {
  const { dir, old, idle } = repo();
  const now = new Date('2026-11-20T00:00:00.000Z');
  const plan = planGarden(dir, { now });
  assert.deepStrictEqual(plan.learnings.map((item) => item.id), ['L-dead']);
  assert.strictEqual(plan.featureMap.find((row) => row.id === 'dead').action, 'move-to-stale');
  assert.strictEqual(plan.featureMap.find((row) => row.id === 'mixed').action, 'report');
  assert.ok(!plan.featureMap.some((row) => row.id === 'live'));
  assert.strictEqual(plan.runs.find((row) => row.runId === old.runId).action, 'keep');
  assert.strictEqual(plan.runs.find((row) => row.runId === idle.runId).action, 'review');
  assert.strictEqual(plan.applied, false);

  const dry = cli(dir, 'refresh', '--garden', '--json');
  assert.strictEqual(dry.status, 0, dry.stdout + dry.stderr);
  const body = JSON.parse(dry.stdout);
  assert.strictEqual(body.applied, false);
  assert.ok(body.writes.includes('.ai-engineering-loop/feature-map.md'));
  assert.strictEqual(fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'feature-map.md'), 'utf8'), MAP);
  assert.ok(!fs.existsSync(path.join(dir, '.ai-engineering-loop', 'feature-map.md.ael-backup')));
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'learnings.json'), 'utf8')).entries.some((entry) => entry.id === 'L-dead'));
  assert.strictEqual(fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'architecture.md'), 'utf8'), 'USER NOTES\n');

  const applied = cli(dir, 'refresh', '--garden', '--yes', '--json');
  assert.strictEqual(applied.status, 0, applied.stdout + applied.stderr);
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'learnings.json'), 'utf8'));
  assert.deepStrictEqual(after.entries.map((entry) => entry.id), ['L-live']);
  assert.ok(after.suppressed.some((entry) => entry.id === 'L-dead' && entry.reason === 'files-removed'));
  const map = fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'feature-map.md'), 'utf8');
  assert.match(map, /\| live \|/);
  assert.match(map, /\| mixed \|/);
  assert.match(map, /## Stale \(garden\)[\s\S]*\| dead \|/);
  assert.doesNotMatch(map.split('## Stale (garden)')[0], /\| dead \|/);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'feature-map.md.ael-backup'), 'utf8'), MAP);
  assert.ok(fs.existsSync(path.join(runsDir(dir), old.runId, 'state.json')));
  assert.ok(fs.existsSync(path.join(runsDir(dir), idle.runId, 'state.json')));
  assert.strictEqual(fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'architecture.md'), 'utf8'), 'USER NOTES\n');

  const both = cli(dir, 'refresh', '--garden', '--non-destructive', '--json');
  assert.notStrictEqual(both.status, 0);
  assert.strictEqual(JSON.parse(both.stdout).code, 'INVALID_USAGE');
});
