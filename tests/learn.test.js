'use strict';

// Issue #61: `ael learn` mines past Runs into project learnings for context packs.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { createRun, runsDir } = require('../lib/run-state.js');
const { learn, selectLearnings, isLesson } = require('../lib/learn.js');
const { createContextPack, redactSecrets, CONTEXT_PROFILE_LIMITS } = require('../lib/safe-context.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-learn-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/list.js'), 'module.exports = (items) => items;\n');
  fs.writeFileSync(path.join(dir, 'src/page.js'), 'module.exports = 1;\n');
  return dir;
}

let clock = Date.parse('2026-10-01T00:00:00Z');
function runWith(dir, findings) {
  clock += 60_000;
  const run = createRun(dir, { task: 'Paginate', now: new Date(clock) });
  fs.writeFileSync(path.join(runsDir(dir), run.runId, 'findings.json'), JSON.stringify({ schemaVersion: 1, runId: run.runId, diffHash: 'x', findings }));
  return run.runId;
}

function finding(id, scenario, extra = {}) {
  return { id, location: 'src/list.js#L1', failureScenario: scenario, evidence: 'e', severity: 'MEDIUM', validity: 'VALID', disposition: 'ACCEPTABLE', axis: 'spec', ...extra };
}

test('learn keeps only VALID, non-rejected findings and dedupes recurring ones with runId provenance', () => {
  const dir = project();
  const first = runWith(dir, [
    finding('F1', 'Empty list input returns undefined instead of an empty page'),
    finding('F2', 'Speculative concern about performance', { validity: 'INVALID' }),
    finding('F3', 'Off-by-one on the last page boundary', { status: 'REJECTED' }),
    finding('F4', 'src/x.js changed outside the impact map', { source: 'impact-map', severity: 'LOW' })
  ]);
  const second = runWith(dir, [
    finding('F1', 'empty list input returns undefined instead of empty page', { severity: 'HIGH', concreteAlternativeDiff: 'd' }),
    finding('F2', 'Missing JSDoc on exported helper', { axis: 'standards', location: 'src/page.js:3' })
  ]);
  const result = learn(dir);
  assert.strictEqual(result.written, true);
  const entries = result.document.entries;
  assert.strictEqual(entries.length, 2);
  const empty = entries[0];
  assert.match(empty.lesson, /^empty list input/);
  assert.strictEqual(empty.occurrences, 2);
  assert.strictEqual(empty.severity, 'HIGH');
  assert.deepStrictEqual(empty.runIds, [first, second].sort());
  assert.deepStrictEqual(empty.locations, ['src/list.js']);
  assert.deepStrictEqual(entries[1].locations, ['src/page.js']);
  assert.ok(!JSON.stringify(entries).includes('Speculative'));
  assert.ok(!JSON.stringify(entries).includes('Off-by-one'));
  assert.ok(!JSON.stringify(entries).includes('impact map'));
  assert.strictEqual(isLesson(finding('x', 'y', { resolution: 'wont_fix' })), false);
  const md = fs.readFileSync(path.join(dir, '.ai-engineering-loop/learnings.md'), 'utf8');
  assert.match(md, new RegExp(`${empty.id}.*×2`));
});

test('output is deterministic and --dry-run writes nothing', () => {
  const dir = project();
  runWith(dir, [finding('F1', 'Page size zero divides by zero')]);
  runWith(dir, [finding('F1', 'Page size zero divides by zero'), finding('F2', 'Negative page returns items')]);
  const dry = learn(dir, { dryRun: true });
  assert.strictEqual(dry.written, false);
  assert.ok(!fs.existsSync(path.join(dir, '.ai-engineering-loop/learnings.json')));
  learn(dir);
  const once = fs.readFileSync(path.join(dir, '.ai-engineering-loop/learnings.json'), 'utf8');
  learn(dir);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.ai-engineering-loop/learnings.json'), 'utf8'), once);
  assert.deepStrictEqual(JSON.parse(once), dry.document);
});

test('--prune drops lessons whose files are gone, stale ones, and superseded ones until they recur', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'src/gone.js'), '1\n');
  runWith(dir, [finding('F1', 'Gone helper leaks handles', { location: 'src/gone.js' })]);
  runWith(dir, [finding('F1', 'Old rule nobody repeats about caching layers')]);
  runWith(dir, [finding('F1', 'Retry loop never stops on 500 responses')]);
  runWith(dir, [finding('F1', 'Retry loop never stops on 500 responses')]);
  fs.rmSync(path.join(dir, 'src/gone.js'));
  const result = learn(dir, { prune: true, maxAgeRuns: 2 });
  assert.deepStrictEqual(result.pruned.map((item) => item.reason).sort(), ['files-removed', 'stale']);
  assert.deepStrictEqual(result.document.entries.map((entry) => entry.lesson), ['Retry loop never stops on 500 responses']);
  assert.strictEqual(learn(dir).document.entries.length, 1, 'pruned entries stay pruned without --prune');

  const file = path.join(dir, '.ai-engineering-loop/learnings.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.entries[0].supersededBy = 'docs/retry-policy.md';
  fs.writeFileSync(file, JSON.stringify(doc));
  const superseded = learn(dir, { prune: true, maxAgeRuns: 2 });
  assert.deepStrictEqual(superseded.document.entries, []);
  assert.ok(superseded.document.suppressed.some((item) => item.reason === 'superseded'));
  runWith(dir, [finding('F9', 'Retry loop never stops on 500 responses')]);
  assert.strictEqual(learn(dir).document.entries.length, 1, 'a suppressed lesson returns when it recurs');
});

test('learnings pass safe-context secret filtering', () => {
  const dir = project();
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  runWith(dir, [finding('F1', `Token ${secret} is logged in /Users/ega/app/server.js on retry`)]);
  learn(dir);
  for (const file of ['learnings.json', 'learnings.md']) {
    const text = fs.readFileSync(path.join(dir, '.ai-engineering-loop', file), 'utf8');
    assert.ok(!text.includes(secret), file);
    assert.ok(!text.includes('/Users/ega'), file);
    assert.deepStrictEqual(redactSecrets(text).categories, [], `${file} still has secrets`);
  }
});

test('maker and devil-advocate packs include relevant learnings without exceeding the token budget', () => {
  const dir = project();
  for (let index = 0; index < 8; index += 1) {
    runWith(dir, [finding('F1', `Lesson number ${'abcdefgh'[index]} about list paging ${'x'.repeat(200)}`), finding('F2', 'Recurring empty page bug', { location: 'src/page.js' })]);
  }
  learn(dir);
  const run = createRun(dir, { task: 'next', now: new Date(clock += 60_000) });
  const maker = createContextPack(dir, { runId: run.runId, stage: 'maker', files: ['src/list.js'] }).pack;
  assert.ok(maker.learnings.length >= 1 && maker.learnings.length <= 5);
  assert.ok(maker.learnings.some((item) => item.locations.includes('src/list.js')));
  const limits = CONTEXT_PROFILE_LIMITS.lean.maker;
  assert.ok(maker.learningTokens <= limits.maxEstimatedTokens * 0.1, `${maker.learningTokens}`);
  assert.ok(maker.estimatedTokens <= limits.maxEstimatedTokens);
  const judge = createContextPack(dir, { runId: run.runId, stage: 'judge', files: ['src/list.js'] }).pack;
  assert.deepStrictEqual(judge.learnings, []);

  // A pack whose files already fill the budget gets no learnings.
  const da = CONTEXT_PROFILE_LIMITS.lean['devil-advocate'];
  for (const name of ['a', 'b', 'c']) fs.writeFileSync(path.join(dir, `src/${name}.js`), 'x'.repeat(da.maxFileBytes));
  const full = createContextPack(dir, { runId: run.runId, stage: 'devil-advocate', files: ['src/a.js', 'src/b.js', 'src/c.js'] }).pack;
  assert.strictEqual(full.estimatedTokens, da.maxEstimatedTokens);
  assert.deepStrictEqual(full.learnings, []);
  assert.strictEqual(selectLearnings(dir, { files: ['src/list.js'], budgetTokens: 10 }).learnings.length, 0);
});

test('CLI learn --json, --dry-run, and unknown flags', () => {
  const dir = project();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-learn-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8' });
  runWith(dir, [finding('F1', 'Empty list returns undefined')]);
  const dry = JSON.parse(cli('learn', '--dry-run', '--json').stdout);
  assert.strictEqual(dry.written, false);
  assert.strictEqual(dry.learnings.entries.length, 1);
  assert.ok(!fs.existsSync(path.join(dir, '.ai-engineering-loop/learnings.json')));
  assert.strictEqual(cli('learn', '--bogus').status, 2);
  assert.strictEqual(cli('learn').status, 0);
  assert.ok(fs.existsSync(path.join(dir, '.ai-engineering-loop/learnings.json')));
});
