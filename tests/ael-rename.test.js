const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { applyHostSync, readHostManifest } = require('../lib/sync-hosts.js');
const { hostsDoctor } = require('../lib/hosts/doctor.js');
const { userStatePath, writeJsonFile } = require('../lib/user-state.js');
const { sha256 } = require('../lib/fsutil.js');

// #107: the core skill is `ael` (/ael); `ael` is a CLI alias.
const ROOT = path.join(__dirname, '..');
const LEGACY = 'ai-engineering-loop';

function claudeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-rename-'));
  fs.mkdirSync(path.join(home, '.claude'));
  return home;
}

// A pre-#107 install: legacy folder files recorded in the manifest by AEL.
function seedLegacy(home, extra = {}) {
  const dir = path.join(home, '.claude/skills', LEGACY);
  const manifest = readHostManifest(home);
  for (const rel of ['SKILL.md', 'references/loop-hosts.md']) {
    const file = path.join(dir, rel);
    const text = `---\nname: ${LEGACY}\n---\nold ${rel}\n`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    manifest.files[file] = { sha256: sha256(text), pack: 'core' };
  }
  for (const [rel, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, rel), text);
  writeJsonFile(userStatePath('host-manifest.json', home), manifest);
  return dir;
}

const selection = { enabled: new Set(['claude']) };

test('fresh sync installs only the ael skill with /ael frontmatter', () => {
  const home = claudeHome();
  applyHostSync({ packageRoot: ROOT, home });
  const skill = fs.readFileSync(path.join(home, '.claude/skills/ael/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: ael\n/);
  assert.ok(!fs.existsSync(path.join(home, '.claude/skills', LEGACY)));
  assert.strictEqual(hostsDoctor({ home, selection, plan: [] }).hosts[0].ok, true);
});

test('sync migrates an AEL-managed legacy skill folder, leaving no duplicate', () => {
  const home = claudeHome();
  const legacyDir = seedLegacy(home);
  assert.match(hostsDoctor({ home, selection, plan: [] }).hosts[0].problems.join('\n'), /legacy ai-engineering-loop skill left over/);
  applyHostSync({ packageRoot: ROOT, home });
  assert.ok(!fs.existsSync(legacyDir), 'legacy folder removed');
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/ael/SKILL.md')));
  assert.ok(!Object.keys(readHostManifest(home).files).some((file) => /[\\/]ai-engineering-loop[\\/]/.test(file)));
  const row = hostsDoctor({ home, selection, plan: [] }).hosts[0];
  assert.deepStrictEqual(row.problems, []);
});

test('user-authored or edited legacy files are kept and doctor flags them', () => {
  const home = claudeHome();
  const legacyDir = seedLegacy(home, { 'notes.md': 'mine\n' });
  fs.appendFileSync(path.join(legacyDir, 'SKILL.md'), 'my edit\n');
  applyHostSync({ packageRoot: ROOT, home });
  assert.ok(fs.existsSync(path.join(legacyDir, 'notes.md')), 'user file kept');
  assert.match(fs.readFileSync(path.join(legacyDir, 'SKILL.md'), 'utf8'), /my edit/);
  assert.ok(!fs.existsSync(path.join(legacyDir, 'references/loop-hosts.md')), 'unedited managed file removed');
  const row = hostsDoctor({ home, selection, plan: [] }).hosts[0];
  assert.strictEqual(row.ok, false);
  assert.match(row.problems.join('\n'), /~\/\.claude\/skills\/ai-engineering-loop\/SKILL\.md/);
});

test('package.json ships `ael` as a bin alias next to ai-engineering-loop', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.name, 'ai-engineering-loop');
  assert.strictEqual(pkg.bin.ael, pkg.bin['ai-engineering-loop']);
  const out = spawnSync(process.execPath, [path.join(ROOT, pkg.bin.ael), '--version'], { encoding: 'utf8' });
  assert.strictEqual(out.status, 0);
  assert.match(out.stdout, new RegExp(pkg.version.replace(/\./g, '\\.')));
});
