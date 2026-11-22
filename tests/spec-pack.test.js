'use strict';

// Issue #96: the `spec` host pack generated from the EGM fork; since 2.17 one
// `ael-spec` skill with a reference per stage, installed by default.

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

test('the pack is one ael-spec skill: licensed, attributed, a stage per reference, no host-specific paths', () => {
  const upstream = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/egm/UPSTREAM.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(SPEC_SKILL_FILES), ['ael-spec']);
  assert.deepStrictEqual(fs.readdirSync(path.join(ROOT, 'adapters/spec/skills')), ['ael-spec']);
  const router = fs.readFileSync(path.join(ROOT, 'adapters/spec/skills/ael-spec/SKILL.md'), 'utf8');
  assert.match(router, /^---\nname: ael-spec\n/);
  assert.match(router, /^license: Apache-2\.0$/m);
  for (const stage of ['brainstorm', 'draft', 'review', 'review-loop', 'resolve', 'drift']) {
    assert.match(router, new RegExp(`references/spec-${stage}\\.md`), stage);
  }
  for (const file of SPEC_SKILL_FILES['ael-spec']) {
    const text = fs.readFileSync(path.join(ROOT, 'adapters/spec/skills/ael-spec', file), 'utf8');
    assert.ok(text.includes(`@${upstream.commit.slice(0, 12)}`), `${file} names the fork commit`);
    assert.doesNotMatch(text, /\begm-[a-z]|CLAUDE_PLUGIN_ROOT|docs\/(claude|codex|harnesses)\.md/, file);
    if (file.startsWith('references/spec-')) assert.doesNotMatch(text, /^---\nname:/, `${file} is a reference, not a skill`);
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
  for (const stage of ['review', 'brainstorm', 'review-loop']) {
    const text = fs.readFileSync(path.join(ROOT, 'adapters/spec/skills/ael-spec/references', `spec-${stage}.md`), 'utf8');
    assert.match(text, /no subagent tool, do not stop/);
    assert.match(text, /CONTEXT_ISOLATION_ONLY/);
  }
});

test('sync-hosts installs the ael-spec skill by default on every host folder and prunes the old ael-spec-* skills', () => {
  const home = tmpHome();
  for (const dir of ['.claude', '.grok', '.cursor']) fs.mkdirSync(path.join(home, dir));
  const results = applyHostSync({ packageRoot: ROOT, home });
  assert.deepStrictEqual(results.packs, ['core', 'quality', 'spec']);
  assert.ok(!fs.existsSync(path.join(home, '.claude/skills/ael-spec-review')));
  for (const host of HOSTS.filter((item) => ['claude', 'grok', 'cursor'].includes(item.id))) {
    for (const [skill, files] of Object.entries(SPEC_SKILL_FILES)) {
      for (const file of files) {
        assert.ok(host.reads.some((dir) => fs.existsSync(path.join(home, dir, skill, file))), `${host.id} sees ${skill}/${file}`);
      }
    }
  }
});

test('an unedited old ael-spec-review skill from an earlier sync is pruned; an edited one is kept', () => {
  const crypto = require('crypto');
  const { readHostManifest } = require('../lib/sync-hosts.js');
  const { userStatePath } = require('../lib/user-state.js');
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  applyHostSync({ packageRoot: ROOT, home });
  const old = path.join(home, '.claude/skills/ael-spec-review/SKILL.md');
  const edited = path.join(home, '.claude/skills/ael-spec-drift/SKILL.md');
  const digest = crypto.createHash('sha256').update('old skill\n').digest('hex');
  const manifest = readHostManifest(home);
  for (const file of [old, edited]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'old skill\n');
    manifest.files[file] = { sha256: digest, pack: 'spec' };
  }
  fs.writeFileSync(userStatePath('host-manifest.json', home), JSON.stringify(manifest));
  fs.writeFileSync(edited, 'my edits\n');
  applyHostSync({ packageRoot: ROOT, home });
  assert.ok(!fs.existsSync(old), 'unedited old skill pruned');
  assert.ok(fs.existsSync(edited), 'edited old skill kept');
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/ael-spec/SKILL.md')));
});
