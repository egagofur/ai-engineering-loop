'use strict';

// Issue #35: one source for host skills, slim SKILL.md, on-demand references.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const { buildHostSkills, checkHostSkills, SKILL_CHAR_LIMIT, SOURCE_DIR } = require('../lib/host-skill-build.js');
const { planHostSync, applyHostSync, LOOP_REFERENCE_FILES } = require('../lib/sync-hosts.js');
const { resolveDoc } = require('../lib/docs.js');

const skills = () => buildHostSkills(ROOT).filter((out) => out.kind === 'skill');

test('generated host skills match skill-src (drift check)', () => {
  assert.deepStrictEqual(checkHostSkills(ROOT), []);
  assert.deepStrictEqual(skills().map((out) => out.path), [
    '.claude/skills/ai-engineering-loop/SKILL.md',
    '.agents/skills/ai-engineering-loop/SKILL.md'
  ]);
});

test('one host-neutral skill: every output is byte-identical (#48)', () => {
  const byName = new Map();
  for (const out of buildHostSkills(ROOT).filter((item) => item.kind !== 'digest')) {
    const name = out.path.split('/ai-engineering-loop/')[1];
    if (!byName.has(name)) byName.set(name, out.content);
    assert.strictEqual(out.content, byName.get(name), `${out.path} differs from its sibling copy`);
  }
  assert.ok(byName.has('references/loop-hosts.md'));
  const skill = byName.get('SKILL.md');
  // Standard Agent Skills frontmatter only (agentskills.io): first bytes, name + description.
  assert.match(skill, /^---\nname: ai-engineering-loop\ndescription: [^\n]{1,1024}\n---\n/);
  assert.doesNotMatch(skill.split('\n---\n')[0], /allowed-tools|user-invocable/);
  assert.doesNotMatch(skill, /Claude Code\)|\(Grok CLI\)|\(Antigravity\)/, 'SKILL.md must not be host-branded');
});

test('a hand edit of a generated file is reported as drift', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-skill-drift-'));
  fs.cpSync(path.join(ROOT, SOURCE_DIR), path.join(tmp, SOURCE_DIR), { recursive: true });
  for (const out of buildHostSkills(ROOT)) {
    fs.mkdirSync(path.dirname(path.join(tmp, out.path)), { recursive: true });
    fs.writeFileSync(path.join(tmp, out.path), out.content);
  }
  assert.deepStrictEqual(checkHostSkills(tmp), []);
  const edited = '.claude/skills/ai-engineering-loop/SKILL.md';
  fs.appendFileSync(path.join(tmp, edited), '\nmanual edit\n');
  fs.rmSync(path.join(tmp, '.agents/skills/ai-engineering-loop/references/loop-goal.md'));
  assert.deepStrictEqual(checkHostSkills(tmp).sort(), ['.agents/skills/ai-engineering-loop/references/loop-goal.md', '.claude/skills/ai-engineering-loop/SKILL.md']);
});

test('every host SKILL.md stays within the always-loaded budget and keeps the quality core', () => {
  for (const out of skills()) {
    const text = out.content;
    assert.ok(text.length <= SKILL_CHAR_LIMIT, `${out.path}: ${text.length} chars > ${SKILL_CHAR_LIMIT}`);
    assert.match(text, /AC is a failure table/, out.path);
    assert.match(text, /One red test per AC row/, out.path);
    assert.match(text, /Do not spawn Devil's Advocate if the file is missing or any Claimed row lacks Reality/, out.path);
    assert.match(text, /iteration 3/, out.path);
    assert.match(text, /Never infer human approval/, out.path);
    assert.match(text, /budget record/, out.path);
    assert.match(text, /\*\*T0\*\*[\s\S]*\*\*T1\*\*[\s\S]*\*\*T2\*\*/, out.path);
    assert.match(text, /Generated from skill-src/, out.path);
    assert.doesNotMatch(text, /\{\{[a-zA-Z]+\}\}/, `${out.path} has an unrendered placeholder`);
  }
});

test('every loop-* reference named by a skill exists beside it and through docs', () => {
  const refs = new Set(LOOP_REFERENCE_FILES.map((f) => f.replace(/\.md$/, '')));
  for (const out of skills()) {
    for (const [, name] of out.content.matchAll(/`(loop-[a-z]+)`/g)) {
      assert.ok(refs.has(name), `${out.path} names unknown reference ${name}`);
      assert.ok(resolveDoc(name), `docs ${name} does not resolve`);
      assert.ok(fs.existsSync(path.join(ROOT, path.dirname(out.path), 'references', `${name}.md`)), `${out.path}: ${name} missing beside it`);
    }
  }
  const source = fs.readdirSync(path.join(ROOT, SOURCE_DIR, 'references')).sort();
  assert.deepStrictEqual(source, [...LOOP_REFERENCE_FILES].sort());
});

test('sync-hosts installs references beside each host SKILL.md', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-skill-refs-'));
  for (const dir of ['.claude', '.grok', '.gemini/antigravity']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  const plan = planHostSync({ packageRoot: ROOT, home });
  for (const skillDir of ['.claude/skills/ai-engineering-loop', '.agents/skills/ai-engineering-loop', '.gemini/config/skills/ai-engineering-loop']) {
    for (const file of LOOP_REFERENCE_FILES) {
      const dest = path.join(home, skillDir, 'references', file);
      assert.ok(plan.some((item) => item.dest === dest), `plan misses ${dest}`);
    }
  }
  applyHostSync({ packageRoot: ROOT, home });
  // sync-hosts normalizes line endings; a Windows checkout may have CRLF.
  const lf = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const installed = lf(path.join(home, '.claude/skills/ai-engineering-loop/references/loop-review.md'));
  assert.strictEqual(installed, lf(path.join(ROOT, '.claude/skills/ai-engineering-loop/references/loop-review.md')));
});

test('gate maker --from-git captures tracked and new files, excluding .ai-engineering-loop', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-fromgit-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-fromgit-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home };
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env, encoding: 'utf8' });
  fs.writeFileSync(path.join(repo, 'a.js'), 'module.exports = 1;\n');
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
  assert.strictEqual(cli('init').status, 0);
  git('add', '-A');
  git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'ctx', '--allow-empty');
  const run = JSON.parse(cli('run', '--json', 'Add a counter module').stdout);
  const runDir = path.join(repo, '.ai-engineering-loop/runs', run.runId);
  fs.writeFileSync(path.join(runDir, 'goal-contract.json'), JSON.stringify({
    schemaVersion: 1, runId: run.runId, objective: 'counter',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'counts', evidenceRequired: 'test', failureCases: ['negative input'] }]
  }));
  assert.strictEqual(cli('gate', 'goal').status, 0);
  const empty = cli('gate', 'maker', '--from-git');
  assert.notStrictEqual(empty.status, 0);
  assert.match(empty.stdout + empty.stderr, /no changes/);
  fs.writeFileSync(path.join(repo, 'a.js'), 'module.exports = 2;\n');
  fs.writeFileSync(path.join(repo, 'counter.js'), 'module.exports = () => 0;\n');
  const gated = cli('gate', 'maker', '--from-git');
  assert.strictEqual(gated.status, 0, gated.stdout + gated.stderr);
  const diff = fs.readFileSync(path.join(runDir, 'diff.patch'), 'utf8');
  assert.match(diff, /a\.js/);
  assert.match(diff, /counter\.js/);
  assert.doesNotMatch(diff, /\.ai-engineering-loop\//);
  const misuse = cli('gate', 'verification', '--from-git');
  assert.notStrictEqual(misuse.status, 0);
});

test('measure script drives T0, T1, T2 to DELIVERED with 0, 1, 2 subagents', () => {
  const { measureAll, BASELINE } = require('../scripts/measure.js');
  const { results } = measureAll();
  assert.deepStrictEqual(results.map((r) => [r.tier, r.finalState, r.subagents]), [
    ['T0', 'DELIVERED', 0],
    ['T1', 'DELIVERED', 1],
    ['T2', 'DELIVERED', 2]
  ]);
  const t1 = results[1];
  assert.ok(t1.parentCalls <= BASELINE.parentCalls / 2, `T1 calls ${t1.parentCalls}`);
  assert.ok(t1.parentContextChars <= BASELINE.parentContextChars / 2, `T1 context ${t1.parentContextChars}`);
});
