'use strict';

// Issue #36: adopted skills follow the slim rules and stay out of the default install.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { applyHostSync, planHostSync, QUALITY_SKILLS } = require('../lib/sync-hosts.js');
const { listPackageFiles } = require('../lib/package-audit.js');

const ADOPTED = Object.freeze([
  'adapters/project-onboarding/SKILL.md',
  'adapters/quality/skills/ael-code-simplifier/SKILL.md',
  'adapters/quality/skills/ael-receiving-code-review/SKILL.md'
]);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');
}

test('adopted skills are <=150 lines with single-line "Use when ... Does NOT" descriptions', () => {
  for (const rel of ADOPTED) {
    const text = read(rel);
    assert.ok(text.split('\n').length <= 150, `${rel} exceeds 150 lines`);
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, `${rel} frontmatter`);
    assert.match(fm[1], /^name: [a-z0-9-]+$/m, rel);
    const desc = fm[1].split('\n').find((line) => line.startsWith('description:'));
    assert.ok(desc && !/description:\s*>/.test(desc), `${rel} needs a single-line description`);
    assert.match(desc, /^description: Use when /, rel);
    assert.match(desc, /Does NOT /, rel);
    assert.ok(desc.length <= 400, `${rel} description is ${desc.length} chars`);
    assert.doesNotMatch(text, /PROACTIVELY|1% rule|before any response/i, rel);
  }
});

test('using-dot-skills is not adopted anywhere in the package', () => {
  for (const file of listPackageFiles(ROOT)) {
    const rel = typeof file === 'string' ? file : file.rel || file.path;
    assert.doesNotMatch(String(rel), /using-dot-skills/, rel);
  }
  assert.doesNotMatch(read('lib/sync-hosts.js'), /using-dot-skills/);
});

test('project-onboarding ships in core; the quality pack is opt-in on every host', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-adopt-'));
  for (const dir of ['.claude', '.grok', '.gemini', '.agents']) fs.mkdirSync(path.join(home, dir));
  applyHostSync({ packageRoot: ROOT, home });
  const roots = ['.claude/skills', '.grok/skills', '.gemini/config/skills', '.agents/skills'];
  for (const root of roots) {
    assert.ok(fs.existsSync(path.join(home, root, 'project-onboarding/SKILL.md')), root);
    assert.ok(fs.existsSync(path.join(home, root, 'project-onboarding/references/output.md')), root);
    for (const skill of QUALITY_SKILLS) assert.ok(!fs.existsSync(path.join(home, root, skill)), `${root}/${skill} installed by default`);
  }
  applyHostSync({ packageRoot: ROOT, home, packs: 'quality' });
  for (const root of roots) {
    for (const skill of QUALITY_SKILLS) assert.ok(fs.existsSync(path.join(home, root, skill, 'SKILL.md')), `${root}/${skill}`);
  }
  assert.match(fs.readFileSync(path.join(home, '.grok/skills/ael-code-simplifier/SKILL.md'), 'utf8'), /^user-invocable: true$/m);
  assert.deepStrictEqual(planHostSync({ packageRoot: ROOT, home }).packs, ['core', 'quality']);
});

test('merged rules land in their target files without growing SKILL.md', () => {
  assert.match(read('skill-src/ai-engineering-loop/references/loop-verify.md'), /No claim without fresh evidence/);
  assert.match(read('skill-src/ai-engineering-loop/references/loop-review.md'), /ael-receiving-code-review/);
  const rca = read('core/root-cause-analysis.md');
  assert.match(rca, /Trace backward/);
  assert.match(rca, /Three strikes/);
  assert.match(rca, /Test pollution/);
  assert.match(read('bin/ai-engineering-loop.js'), /build -> typecheck -> lint -> test_unit -> security scan/);
  for (const rel of ['.claude/skills/ai-engineering-loop/SKILL.md', '.grok/skills/ai-engineering-loop/SKILL.md']) {
    assert.ok(read(rel).length <= 4000, rel);
  }
});

test('third-party notices credit every adopted source', () => {
  const notices = read('THIRD_PARTY_NOTICES.md');
  for (const source of ['obra/superpowers', 'worldflowai/everything-claude-code', 'Cynthia-cym/project-onboarding']) {
    assert.match(notices, new RegExp(source.replace('/', '\\/')), source);
  }
  assert.match(notices, /No upstream text was copied/);
});

test('ael-code-simplifier does not clash with the dot-plugin code-simplifier skill', () => {
  const dot = new Set(JSON.parse(read('tests/fixtures/dot-plugin-skill-names.json')).skills);
  assert.ok(dot.has('code-simplifier'));
  assert.ok(!dot.has('ael-code-simplifier'));
  assert.ok(QUALITY_SKILLS.includes('ael-code-simplifier'));
  assert.ok(!QUALITY_SKILLS.includes('code-simplifier'));
  assert.match(read('adapters/quality/skills/ael-code-simplifier/SKILL.md'), /^name: ael-code-simplifier$/m);
  assert.ok(!fs.existsSync(path.join(ROOT, 'adapters/quality/skills/code-simplifier')));
});

test('ael-receiving-code-review does not clash with the dot-plugin receiving-code-review skill', () => {
  const dot = new Set(JSON.parse(read('tests/fixtures/dot-plugin-skill-names.json')).skills);
  assert.ok(dot.has('receiving-code-review'));
  assert.ok(!dot.has('ael-receiving-code-review'));
  assert.ok(QUALITY_SKILLS.includes('ael-receiving-code-review'));
  assert.ok(!QUALITY_SKILLS.includes('receiving-code-review'));
  assert.match(read('adapters/quality/skills/ael-receiving-code-review/SKILL.md'), /^name: ael-receiving-code-review$/m);
  assert.ok(!fs.existsSync(path.join(ROOT, 'adapters/quality/skills/receiving-code-review')));
  // No AEL quality skill shares a name with a dot-plugin skill.
  for (const name of QUALITY_SKILLS) assert.ok(!dot.has(name), `${name} clashes with dot-plugin`);
});
