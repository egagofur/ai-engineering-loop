'use strict';

// Issue #96: the opt-in `spec` host pack generated from the EGM fork.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const spec = require('../scripts/sync-spec-pack.js');
const { applyHostSync, SPEC_SKILL_FILES } = require('../lib/sync-hosts.js');
const { resolveDoc } = require('../lib/docs.js');
const { HOSTS } = require('../lib/hosts/registry.js');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-spec-home-'));
}

test('adapters/spec is generated from vendor/egm and up to date', () => {
  const files = spec.generate();
  assert.deepStrictEqual(spec.problems(files), []);
  assert.deepStrictEqual(spec.check(files), []);
});

test('a vendor change makes --check report the stale file', () => {
  const files = spec.generate();
  files.set('skills/ael-spec-review/SKILL.md', `${files.get('skills/ael-spec-review/SKILL.md')}\nedited upstream\n`);
  assert.deepStrictEqual(spec.check(files), ['skills/ael-spec-review/SKILL.md']);
});

test('generated skills are ael-spec-*, licensed, attributed, and free of host-specific paths', () => {
  const upstream = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/egm/UPSTREAM.json'), 'utf8'));
  for (const [skill, extra] of Object.entries(SPEC_SKILL_FILES)) {
    const text = fs.readFileSync(path.join(ROOT, 'adapters/spec/skills', skill, 'SKILL.md'), 'utf8');
    assert.match(text, new RegExp(`^---\\nname: ${skill}\\n`), `${skill} frontmatter name`);
    assert.match(text, /^license: Apache-2\.0$/m);
    assert.ok(text.includes(`@${upstream.commit.slice(0, 12)}`), `${skill} names the fork commit`);
    assert.doesNotMatch(text, /\begm-[a-z]|CLAUDE_PLUGIN_ROOT|docs\/(claude|codex|harnesses)\.md/);
    for (const file of extra) assert.ok(fs.existsSync(path.join(ROOT, 'adapters/spec/skills', skill, file)), `${skill}/${file}`);
  }
  assert.deepStrictEqual(spec.problems(new Map([['skills/x/SKILL.md', '---\nname: x\nlicense: Apache-2.0\n---\nrun egm-review\n']])), ['skills/x/SKILL.md: forbidden "egm-r"']);
});

test('every persona and standard the pack cites resolves with `docs`', () => {
  const cited = new Set();
  for (const [rel, text] of spec.generate()) {
    if (!rel.endsWith('.md')) continue;
    for (const match of text.matchAll(/npx ai-engineering-loop docs ([A-Za-z0-9_.{}<>-]+)/g)) cited.add(match[1]);
  }
  const concrete = [...cited].filter((name) => !/[{}<>]/.test(name));
  assert.ok(concrete.includes('loop-hosts'));
  assert.ok(concrete.includes('ael-spec-zoom-out'));
  for (const name of concrete) assert.ok(resolveDoc(name), `docs ${name} resolves`);
  for (const persona of Object.values(spec.PERSONAS)) assert.ok(resolveDoc(persona), persona);
  for (const standard of spec.STANDARDS) assert.ok(resolveDoc(`ael-spec-${standard}`), standard);
});

test('no-subagent hosts fall back to disclosed CONTEXT_ISOLATION_ONLY instead of stopping', () => {
  for (const skill of ['ael-spec-review', 'ael-spec-brainstorm', 'ael-spec-review-loop']) {
    const text = fs.readFileSync(path.join(ROOT, 'adapters/spec/skills', skill, 'SKILL.md'), 'utf8');
    assert.match(text, /no subagent tool, do not stop/);
    assert.match(text, /CONTEXT_ISOLATION_ONLY/);
  }
});

test('sync-hosts installs the spec pack only when selected, on every host folder', () => {
  const home = tmpHome();
  for (const dir of ['.claude', '.grok', '.cursor']) fs.mkdirSync(path.join(home, dir));
  applyHostSync({ packageRoot: ROOT, home });
  assert.ok(!fs.existsSync(path.join(home, '.claude/skills/ael-spec-review')));
  const results = applyHostSync({ packageRoot: ROOT, home, packs: 'spec' });
  assert.deepStrictEqual(results.packs, ['core', 'spec']);
  for (const host of HOSTS.filter((item) => ['claude', 'grok', 'cursor'].includes(item.id))) {
    for (const [skill, files] of Object.entries(SPEC_SKILL_FILES)) {
      for (const file of files) {
        assert.ok(host.reads.some((dir) => fs.existsSync(path.join(home, dir, skill, file))), `${host.id} sees ${skill}/${file}`);
      }
    }
  }
});
