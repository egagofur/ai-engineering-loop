const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  applyGrokSkillOverlay,
  planHostSync,
  applyHostSync,
  summarizeHostSync
} = require('../lib/sync-hosts.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-home-'));
}

test('applyGrokSkillOverlay inserts user-invocable once', () => {
  const raw = '---\nname: demo\ndescription: x\n---\n\n# Body\n';
  const once = applyGrokSkillOverlay(raw);
  assert.match(once, /user-invocable: true/);
  const twice = applyGrokSkillOverlay(once);
  assert.strictEqual(twice, once);
});

test('planHostSync skips everything when no host roots exist', () => {
  const home = tmpHome();
  const plan = planHostSync({ packageRoot: ROOT, home });
  assert.ok(plan.length > 0);
  assert.ok(plan.every((item) => item.action === 'skip'));
  const reasons = new Set(plan.map((item) => item.reason));
  assert.ok(reasons.has('host-missing'));
});

test('sync upserts Claude AEL files but does not invent DOT skills', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  const results = applyHostSync({ packageRoot: ROOT, home });
  const claude = results.filter((item) => item.id === 'claude');
  assert.ok(claude.every((item) => item.action === 'copy'));
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/ai-engineering-loop/SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/agents/devil-advocate.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/agents/judge.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/commands/ai-engineering-loop.md')));
  assert.ok(!fs.existsSync(path.join(home, '.claude/skills/dot-dev-workflow/SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/task-impact-inquiry/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(home, '.claude/settings.local.json')));
});

test('sync upserts task-impact-inquiry onto Claude, Grok, and Gemini', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.grok'));
  fs.mkdirSync(path.join(home, '.gemini'));
  applyHostSync({ packageRoot: ROOT, home });
  const claude = fs.readFileSync(path.join(home, '.claude/skills/task-impact-inquiry/SKILL.md'), 'utf8');
  const grok = fs.readFileSync(path.join(home, '.grok/skills/task-impact-inquiry/SKILL.md'), 'utf8');
  const gemini = fs.readFileSync(path.join(home, '.gemini/config/skills/task-impact-inquiry/SKILL.md'), 'utf8');
  assert.match(claude, /name: task-impact-inquiry/);
  assert.doesNotMatch(claude, /```mermaid/);
  assert.match(claude, /New-dev briefing/);
  assert.match(grok, /^user-invocable: true$/m);
  assert.match(grok, /Where it hits/);
  assert.match(gemini, /Business blast radius|blast radius/);
});

test('DOT skills update only when already installed', () => {
  const home = tmpHome();
  const dest = path.join(home, '.claude/skills/dot-dev-workflow/SKILL.md');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, 'stale\n');
  const results = applyHostSync({ packageRoot: ROOT, home });
  const dotWf = results.find((item) => item.dest === dest);
  assert.strictEqual(dotWf.action, 'copy');
  assert.match(fs.readFileSync(dest, 'utf8'), /Not a substitute for ai-engineering-loop/);
});

test('Grok skill overlay keeps user-invocable', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.grok'));
  const dot = path.join(home, '.grok/skills/dot-dev-workflow/SKILL.md');
  fs.mkdirSync(path.dirname(dot), { recursive: true });
  fs.writeFileSync(dot, '---\nname: dot-dev-workflow\ndescription: old\n---\n\nold\n');
  applyHostSync({ packageRoot: ROOT, home });
  const skill = fs.readFileSync(path.join(home, '.grok/skills/ai-engineering-loop/SKILL.md'), 'utf8');
  const wf = fs.readFileSync(dot, 'utf8');
  assert.match(skill, /^user-invocable: true$/m);
  assert.match(wf, /^user-invocable: true$/m);
});

test('dry-run does not write; second apply is current', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.gemini'));
  const dry = applyHostSync({ packageRoot: ROOT, home, dryRun: true });
  const gemini = dry.find((item) => item.id === 'gemini');
  assert.strictEqual(gemini.action, 'copy');
  assert.ok(gemini.dryRun);
  assert.ok(!fs.existsSync(path.join(home, '.gemini/config/skills/ai-engineering-loop/SKILL.md')));
  applyHostSync({ packageRoot: ROOT, home });
  const again = applyHostSync({ packageRoot: ROOT, home });
  assert.strictEqual(summarizeHostSync(again.filter((item) => item.id === 'gemini')).current, 4);
  assert.strictEqual(summarizeHostSync(again.filter((item) => item.id === 'gemini')).copy, 0);
});

test('symlink destinations are left alone', () => {
  const home = tmpHome();
  const skillDir = path.join(home, '.claude/skills/ai-engineering-loop');
  fs.mkdirSync(skillDir, { recursive: true });
  const target = path.join(home, 'outside.md');
  fs.writeFileSync(target, 'keep me\n');
  fs.symlinkSync(target, path.join(skillDir, 'SKILL.md'));
  applyHostSync({ packageRoot: ROOT, home });
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'keep me\n');
  assert.ok(fs.lstatSync(path.join(skillDir, 'SKILL.md')).isSymbolicLink());
});

test('CLI sync-hosts --dry-run respects AEL_HOME', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.agents'));
  const out = execFileSync('node', [CLI, 'sync-hosts', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, AEL_HOME: home }
  });
  assert.match(out, /dry-run/);
  assert.match(out, /would-copy|copy:/);
  assert.ok(!fs.existsSync(path.join(home, '.agents/judge.md')));
});

test('CLI help lists sync-hosts', () => {
  const out = execFileSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.match(out, /sync-hosts/);
  assert.match(out, /generate-adapter/);
  assert.match(out, /generate-workflow/);
});

test('sync upserts generate-adapter onto Claude, Grok, and Gemini', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.grok'));
  fs.mkdirSync(path.join(home, '.gemini'));
  applyHostSync({ packageRoot: ROOT, home });
  const claude = fs.readFileSync(path.join(home, '.claude/skills/generate-adapter/SKILL.md'), 'utf8');
  const grok = fs.readFileSync(path.join(home, '.grok/skills/generate-adapter/SKILL.md'), 'utf8');
  assert.match(claude, /name: generate-adapter/);
  assert.doesNotMatch(claude, /```mermaid/);
  assert.match(grok, /^user-invocable: true$/m);
});

test('sync upserts generate-workflow onto Claude, Grok, and Gemini', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.grok'));
  fs.mkdirSync(path.join(home, '.gemini'));
  applyHostSync({ packageRoot: ROOT, home });
  const claude = fs.readFileSync(path.join(home, '.claude/skills/generate-workflow/SKILL.md'), 'utf8');
  const grok = fs.readFileSync(path.join(home, '.grok/skills/generate-workflow/SKILL.md'), 'utf8');
  const gemini = fs.readFileSync(path.join(home, '.gemini/config/skills/generate-workflow/SKILL.md'), 'utf8');
  assert.match(claude, /name: generate-workflow/);
  assert.doesNotMatch(claude, /```mermaid/);
  assert.match(claude, /lessons\.md/);
  assert.match(grok, /^user-invocable: true$/m);
  assert.match(gemini, /Do not start Maker/);
});
