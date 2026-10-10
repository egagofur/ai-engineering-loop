'use strict';

// Epic #26 (P0): slim context and round-trips without weakening quality gates.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { recordUsageUnavailable, readAllUsage } = require('../lib/budget.js');
const { createRun, RUN_MODES } = require('../lib/run-state.js');
const { listDocs, readDoc, resolveDoc } = require('../lib/docs.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const HOST_PARENTS = [
  '.claude/skills/ai-engineering-loop/SKILL.md',
  '.grok/skills/ai-engineering-loop/SKILL.md',
  '.gemini/skills/ai-engineering-loop/SKILL.md',
  '.agents/workflows/ai-engineering-loop.md'
];
const HOST_COMMANDS = [
  '.claude/commands/ai-engineering-loop.md',
  '.grok/commands/ai-engineering-loop.md'
];

function readRepo(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

// #27
test('host skills never ask to read whole spec directories or repo-relative package paths', () => {
  for (const rel of HOST_PARENTS) {
    const text = readRepo(rel);
    assert.doesNotMatch(text, /Read those files/, rel);
    assert.doesNotMatch(text, /read those files/i, rel);
    assert.doesNotMatch(text, /`(core|policies|agents)\/[a-z0-9-]+\.md`/, `${rel} cites a package path the target repo does not have`);
    assert.match(text, /ai-engineering-loop docs <name>/, rel);
  }
});

test('every `docs <name>` cited by a host skill resolves to a packaged spec', () => {
  const names = new Set();
  for (const rel of [...HOST_PARENTS, ...HOST_COMMANDS]) {
    for (const match of readRepo(rel).matchAll(/`(?:npx ai-engineering-loop )?docs ([a-z0-9][a-z0-9/-]*)/g)) {
      names.add(match[1]);
    }
  }
  assert.ok(names.size >= 3, `expected several docs citations, got ${[...names]}`);
  for (const name of names) assert.ok(resolveDoc(name), `docs ${name} does not resolve`);
});

test('docs command lists, prints, and slices sections read-only', () => {
  const docs = listDocs();
  assert.ok(docs.some((doc) => doc.name === 'grill-policy'));
  const section = readDoc('grill-policy', { section: 'When to grill' });
  assert.match(section.text, /^## When to grill/);
  assert.ok(section.text.length < readDoc('grill-policy').text.length);
  assert.throws(() => readDoc('../package'), /Unknown doc/);
  const result = spawnSync(process.execPath, [CLI, 'docs', 'tdd-policy', '--json'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(JSON.parse(result.stdout).rel, 'policies/tdd-policy.md');
});

// #28
test('reviewer budget numbers have one source per host: the agent body, plus one spawn prompt', () => {
  for (const rel of HOST_PARENTS) {
    const text = readRepo(rel);
    // The single parent copy is the literal spawn prompt, kept because a
    // `general-purpose` fallback child never loads the agent file.
    assert.ok(count(text, '8 tool calls') <= 1, `${rel} repeats the DA budget`);
    assert.ok(count(text, '4 tool calls') <= 1, `${rel} repeats the Judge budget`);
  }
  for (const rel of HOST_COMMANDS) {
    const text = readRepo(rel);
    assert.doesNotMatch(text, /\b[48] tool calls\b/, `${rel} must not restate reviewer budgets`);
  }
  const review = readRepo('policies/review-budget.md');
  assert.match(review, /agents\/shared\/devil-advocate\.body\.md/);
});

// #29
test('ASSISTED notes unavailable usage once and continues; UNATTENDED fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-usage-'));
  createRun(root, { runId: 'run-assisted', mode: RUN_MODES.ASSISTED });
  const assisted = recordUsageUnavailable(root, { runId: 'run-assisted', nodeId: 'devil-advocate' });
  assert.strictEqual(assisted.continue, true);
  assert.strictEqual(assisted.entry.usage, 'unavailable');
  // The strict token ledger is untouched, so nothing is undercounted or invented.
  assert.deepStrictEqual(readAllUsage(root), []);

  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-usage-'));
  createRun(other, { runId: 'run-unattended', mode: RUN_MODES.UNATTENDED });
  assert.throws(
    () => recordUsageUnavailable(other, { runId: 'run-unattended' }),
    (err) => err.code === 'USAGE_UNAVAILABLE_UNATTENDED'
  );
});

test('host skills do not ask the human about missing usage in ASSISTED and keep the UNATTENDED stop', () => {
  for (const rel of HOST_PARENTS) {
    const text = readRepo(rel);
    assert.match(text, /budget record --unavailable/, rel);
    assert.match(text, /do not ask the human/, rel);
    assert.match(text, /UNATTENDED fails that command, so stop and escalate/, rel);
    assert.doesNotMatch(text, /requires? human direction in ASSISTED/, rel);
    assert.doesNotMatch(text, /Before every model or (Task|subagent) call/, rel);
  }
  assert.match(readRepo('core/runtime-safety.md'), /USAGE_UNAVAILABLE_UNATTENDED/);
});

// #30
test('Stage 0 no longer runs sync-hosts on every run', () => {
  for (const rel of HOST_PARENTS) {
    const text = readRepo(rel);
    assert.doesNotMatch(text, /Stage 0: `npx ai-engineering-loop sync-hosts`/, rel);
    assert.doesNotMatch(text, /Stage 0: sync hosts/, rel);
    assert.doesNotMatch(text, /Stage 0 runs sync-hosts/, rel);
    assert.match(text, /Do not run `sync-hosts` per run/, rel);
  }
});

// #32
test('DOT router only names skills that exist or are explicitly optional', () => {
  const router = readRepo('adapters/dot/skills/dot-dev-skill-router/SKILL.md');
  const dotPlugin = new Set(JSON.parse(readRepo('tests/fixtures/dot-plugin-skill-names.json')).skills);
  const ael = new Set(['ai-engineering-loop', 'task-impact-inquiry', 'dot-dev-workflow', 'backend-development', 'dot-dev-skill-router']);
  const optionalLine = router.split('\n').find((line) => line.startsWith('- **Optional, if installed:**'));
  assert.ok(optionalLine, 'router must list optional skills');
  const optional = new Set([...optionalLine.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]));
  const legacyAliases = new Set(['dot-verification']);
  const table = router.slice(router.indexOf('## Core rules'), router.indexOf('## Workflow gates'));
  const unknown = [];
  for (const match of table.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)) {
    const name = match[1];
    if (dotPlugin.has(name) || ael.has(name) || optional.has(name) || legacyAliases.has(name)) continue;
    unknown.push(name);
  }
  assert.deepStrictEqual([...new Set(unknown)], []);
  // Plan-execution and brainstorming routes no longer bypass the AEL loop.
  assert.doesNotMatch(router, /`executing-plans` → `ai-engineering-loop`/);
  assert.doesNotMatch(router, /`brainstorming` → /);
  for (const name of optional) {
    assert.ok(!dotPlugin.has(name), `${name} exists in dot-plugin; do not mark it optional`);
  }
});
