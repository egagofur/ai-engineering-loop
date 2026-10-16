const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const {
  planHostSync,
  applyHostSync,
  summarizeHostSync
} = require('../lib/sync-hosts.js');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-home-'));
}

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
  const results = applyHostSync({ packageRoot: ROOT, home, packs: ['backend', 'design'] });
  const claude = results.filter((item) => item.id === 'claude');
  assert.ok(claude.every((item) => item.action === 'copy' || item.reason === 'pack-not-selected'));
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/ai-engineering-loop/SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/agents/devil-advocate.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/agents/judge.md')));
  assert.ok(!fs.existsSync(path.join(home, '.claude/commands/ai-engineering-loop.md')), 'commands retired in #48');
  assert.ok(!fs.existsSync(path.join(home, '.claude/skills/dot-dev-workflow/SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/task-impact-inquiry/SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/emil-design-eng/SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/animate/RECIPES.md')));
  assert.ok(!fs.existsSync(path.join(home, '.claude/settings.local.json')));
});

test('sync upserts task-impact-inquiry onto Claude, Grok, and Gemini', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.grok'));
  fs.mkdirSync(path.join(home, '.gemini/antigravity'), { recursive: true });
  applyHostSync({ packageRoot: ROOT, home });
  const claude = fs.readFileSync(path.join(home, '.claude/skills/task-impact-inquiry/SKILL.md'), 'utf8');
  const grok = fs.readFileSync(path.join(home, '.agents/skills/task-impact-inquiry/SKILL.md'), 'utf8');
  const gemini = fs.readFileSync(path.join(home, '.gemini/config/skills/task-impact-inquiry/SKILL.md'), 'utf8');
  assert.match(claude, /name: task-impact-inquiry/);
  assert.doesNotMatch(claude, /```mermaid/);
  assert.match(claude, /New-dev briefing/);
  assert.match(grok, /Where it hits/);
  assert.match(gemini, /Business blast radius|blast radius/);
});

test('task-impact-inquiry is adapter-neutral: same copy for every host, EN + ID triggers, no DOT-only process (#64)', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.grok'));
  applyHostSync({ packageRoot: ROOT, home });
  const src = fs.readFileSync(path.join(ROOT, 'adapters/quality/skills/task-impact-inquiry/SKILL.md'), 'utf8').replace(/\r\n?/g, '\n');
  for (const rel of ['.claude/skills/task-impact-inquiry/SKILL.md', '.agents/skills/task-impact-inquiry/SKILL.md']) {
    assert.strictEqual(fs.readFileSync(path.join(home, rel), 'utf8').replace(/\r\n?/g, '\n'), src, rel);
  }
  const description = src.match(/^description: (.*)$/m)[1];
  assert.match(description, /check the impact/);
  assert.match(description, /cek impactnya/);
  assert.doesNotMatch(src, /dot-dev-workflow|BullMQ/);
  assert.match(src, /adapter_type: dot/, 'DOT stays mandatory, described as one adapter among others');
  assert.ok(!fs.existsSync(path.join(ROOT, 'adapters/dot/skills/task-impact-inquiry')), 'no stale DOT copy');
  // DOT references still resolve to the shipped file.
  for (const doc of ['core/grill-policy.md', 'adapters/dot/README.md']) {
    const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
    for (const [ref] of text.matchAll(/adapters\/[a-z/-]*task-impact-inquiry[a-zA-Z/.]*/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, ref)), `${doc}: ${ref}`);
    }
  }
});

test('sync upserts backend-development skill and references onto Claude, Grok, Gemini, and Codex-compatible agents', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.grok'));
  fs.mkdirSync(path.join(home, '.gemini/antigravity'), { recursive: true });
  fs.mkdirSync(path.join(home, '.agents'));
  applyHostSync({ packageRoot: ROOT, home, packs: ['backend'] });

  const claudeBase = path.join(home, '.claude/skills/backend-development');
  const grokBase = path.join(home, '.agents/skills/backend-development');
  const geminiBase = path.join(home, '.gemini/config/skills/backend-development');
  const codexBase = path.join(home, '.agents/skills/backend-development');
  const claude = fs.readFileSync(path.join(claudeBase, 'SKILL.md'), 'utf8');
  const grok = fs.readFileSync(path.join(grokBase, 'SKILL.md'), 'utf8');
  const gemini = fs.readFileSync(path.join(geminiBase, 'SKILL.md'), 'utf8');
  const codex = fs.readFileSync(path.join(codexBase, 'SKILL.md'), 'utf8');

  assert.match(claude, /name: backend-development/);
  assert.match(claude, /Boolean naming/);
  assert.match(gemini, /Query and Database Best Practices|Query and Database/);
  assert.match(codex, /name: backend-development/);
  for (const base of [claudeBase, grokBase, geminiBase, codexBase]) {
    assert.ok(fs.existsSync(path.join(base, 'references/api-design-guidelines.md')), base);
    assert.ok(fs.existsSync(path.join(base, 'references/query-and-database-best-practices.md')), base);
    assert.ok(fs.existsSync(path.join(base, 'references/security-checklist.md')), base);
  }
});

test('sync upserts Emil Kowalski design skills onto Claude, Grok, Gemini, and Codex-compatible agents', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.grok'));
  fs.mkdirSync(path.join(home, '.gemini/antigravity'), { recursive: true });
  fs.mkdirSync(path.join(home, '.agents'));
  applyHostSync({ packageRoot: ROOT, home, packs: ['design'] });

  const claude = fs.readFileSync(path.join(home, '.claude/skills/emil-design-eng/SKILL.md'), 'utf8');
  const grok = fs.readFileSync(path.join(home, '.agents/skills/animate/SKILL.md'), 'utf8');
  const gemini = fs.readFileSync(path.join(home, '.gemini/config/skills/review-animations/SKILL.md'), 'utf8');
  const codex = fs.readFileSync(path.join(home, '.agents/skills/apple-design/SKILL.md'), 'utf8');

  assert.match(claude, /name: emil-design-eng/);
  assert.match(claude, /animation|design/i);
  assert.match(grok, /name: animate/);
  assert.match(gemini, /name: review-animations/);
  assert.match(codex, /name: apple-design/);
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/improve-animations/PLAN-TEMPLATE.md')));
  assert.ok(fs.existsSync(path.join(home, '.agents/skills/animate-expo/RECIPES.md')));
  assert.ok(fs.existsSync(path.join(home, '.agents/skills/ask-sonner/API.md')));
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

test('Grok gets the shared skill and no copy of its own; DOT skill stays byte-identical (#48)', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.grok'));
  const dot = path.join(home, '.agents/skills/dot-dev-workflow/SKILL.md');
  fs.mkdirSync(path.dirname(dot), { recursive: true });
  fs.writeFileSync(dot, '---\nname: dot-dev-workflow\ndescription: old\n---\n\nold\n');
  applyHostSync({ packageRoot: ROOT, home });
  const skill = fs.readFileSync(path.join(home, '.agents/skills/ai-engineering-loop/SKILL.md'), 'utf8');
  assert.strictEqual(skill, fs.readFileSync(path.join(ROOT, '.agents/skills/ai-engineering-loop/SKILL.md'), 'utf8').replace(/\r\n?/g, '\n'));
  assert.ok(!fs.existsSync(path.join(home, '.grok/skills')));
  assert.ok(fs.existsSync(path.join(home, '.grok/agents/devil-advocate.md')));
  assert.strictEqual(fs.readFileSync(dot, 'utf8'), fs.readFileSync(path.join(ROOT, 'adapters/dot/skills/dot-dev-workflow/SKILL.md'), 'utf8').replace(/\r\n?/g, '\n'));
});

test('Gemini CLI and Codex homes get the loop through ~/.agents/skills, not ~/.gemini/config (#48)', () => {
  for (const dir of ['.gemini', '.codex']) {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, dir));
    applyHostSync({ packageRoot: ROOT, home });
    assert.ok(fs.existsSync(path.join(home, '.agents/skills/ai-engineering-loop/SKILL.md')), dir);
    assert.ok(fs.existsSync(path.join(home, '.agents/skills/ai-engineering-loop/references/loop-hosts.md')), dir);
    assert.ok(!fs.existsSync(path.join(home, '.gemini/config')), `${dir}: Antigravity path must not be created for Gemini CLI`);
    assert.ok(!fs.existsSync(path.join(home, '.agents/workflows')), dir);
  }
});

test('Antigravity gets skills in ~/.gemini/config/skills and subagents in ~/.gemini/config/agents (#48)', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.gemini/antigravity'), { recursive: true });
  applyHostSync({ packageRoot: ROOT, home });
  assert.ok(fs.existsSync(path.join(home, '.gemini/config/skills/ai-engineering-loop/SKILL.md')));
  for (const name of ['devil-advocate', 'judge']) {
    const agent = fs.readFileSync(path.join(home, `.gemini/config/agents/${name}.md`), 'utf8');
    assert.match(agent, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(agent, /^subagent: true$/m);
  }
  assert.ok(!fs.existsSync(path.join(home, '.agents/workflows')));
  assert.ok(!fs.existsSync(path.join(home, '.agents/judge.md')));
});

test('every host sees one copy, or byte-identical copies, of each AEL skill (#48)', () => {
  const home = tmpHome();
  for (const dir of ['.claude', '.grok', '.gemini/antigravity', '.agents', '.codex']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  applyHostSync({ packageRoot: ROOT, home, packs: ['backend', 'design', 'quality'] });
  // Folders each host scans (official docs, 2026-10): Grok, Cursor, OpenCode, Amp
  // and Augment read ~/.claude/skills next to ~/.agents/skills.
  const reads = [
    ['.grok/skills', '.claude/skills', '.agents/skills'],
    ['.claude/skills'],
    ['.agents/skills'],
    ['.gemini/config/skills']
  ];
  for (const dirs of reads) {
    const seen = new Map();
    for (const dir of dirs) {
      const abs = path.join(home, dir);
      if (!fs.existsSync(abs)) continue;
      for (const name of fs.readdirSync(abs)) {
        const file = path.join(abs, name, 'SKILL.md');
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (seen.has(name)) assert.strictEqual(text, seen.get(name), `${name} differs across ${dirs.join(' + ')}`);
        else seen.set(name, text);
      }
    }
    assert.ok(seen.has('ai-engineering-loop'), dirs.join(' + '));
  }
});

test('upgrade removes retired AEL host files it wrote, keeps edited ones (#48)', () => {
  const home = tmpHome();
  for (const dir of ['.claude', '.grok', '.agents']) fs.mkdirSync(path.join(home, dir));
  const { sha256, writeJsonFile, userStatePath } = require('../lib/user-state.js');
  const retired = {
    '.agents/workflows/ai-engineering-loop.md': 'old workflow\n',
    '.agents/judge.md': 'old judge\n',
    '.claude/commands/ai-engineering-loop.md': 'old command\n',
    '.grok/commands/ai-engineering-loop.md': 'old grok command\n',
    '.grok/skills/ai-engineering-loop/SKILL.md': 'old grok skill\n'
  };
  const files = {};
  for (const [rel, text] of Object.entries(retired)) {
    const abs = path.join(home, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    files[abs] = { sha256: sha256(text), pack: 'core' };
  }
  // The user edited one retired file after AEL wrote it.
  const edited = path.join(home, '.agents/devil-advocate.md');
  fs.writeFileSync(edited, 'my own notes\n');
  files[edited] = { sha256: sha256('what AEL wrote\n'), pack: 'core' };
  writeJsonFile(userStatePath('host-manifest.json', home), { schemaVersion: 1, version: '1.14.0', files });
  applyHostSync({ packageRoot: ROOT, home });
  for (const rel of Object.keys(retired)) assert.ok(!fs.existsSync(path.join(home, rel)), `${rel} should be pruned`);
  assert.strictEqual(fs.readFileSync(edited, 'utf8'), 'my own notes\n');
  assert.ok(fs.existsSync(path.join(home, '.agents/skills/ai-engineering-loop/SKILL.md')));
});

test('dry-run does not write; second apply is current', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.gemini/antigravity'), { recursive: true });
  const dry = applyHostSync({ packageRoot: ROOT, home, dryRun: true });
  const gemini = dry.find((item) => item.id === 'antigravity');
  assert.strictEqual(gemini.action, 'copy');
  assert.ok(gemini.dryRun);
  assert.ok(!fs.existsSync(path.join(home, '.gemini/config/skills/ai-engineering-loop/SKILL.md')));
  applyHostSync({ packageRoot: ROOT, home });
  const again = applyHostSync({ packageRoot: ROOT, home });
  assert.strictEqual(summarizeHostSync(again.filter((item) => item.id === 'antigravity')).copy, 0);
  assert.ok(summarizeHostSync(again.filter((item) => item.id === 'antigravity')).current >= 4);
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

test('sync skips destinations reached through a symlinked parent directory', { skip: process.platform === 'win32' }, () => {
  const home = tmpHome();
  const outside = path.join(home, 'outside');
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(home, '.claude/skills'), 'dir');

  const results = applyHostSync({ packageRoot: ROOT, home });
  const aelSkill = results.find((item) => item.dest === path.join(
    home,
    '.claude/skills/ai-engineering-loop/SKILL.md'
  ));

  assert.equal(aelSkill.action, 'skip');
  assert.equal(aelSkill.reason, 'symlink-ancestor');
  assert.equal(fs.existsSync(path.join(outside, 'ai-engineering-loop/SKILL.md')), false);
});

test('sync respects a symlinked home directory while still guarding paths below it', { skip: process.platform === 'win32' }, () => {
  const parent = tmpHome();
  const actualHome = path.join(parent, 'home');
  const homeAlias = path.join(parent, 'home-alias');
  fs.mkdirSync(path.join(actualHome, '.claude'), { recursive: true });
  fs.symlinkSync(actualHome, homeAlias, 'dir');

  applyHostSync({ packageRoot: ROOT, home: homeAlias });

  assert.ok(fs.existsSync(path.join(actualHome, '.claude/skills/ai-engineering-loop/SKILL.md')));
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
  fs.mkdirSync(path.join(home, '.gemini/antigravity'), { recursive: true });
  applyHostSync({ packageRoot: ROOT, home });
  const claude = fs.readFileSync(path.join(home, '.claude/skills/generate-adapter/SKILL.md'), 'utf8');
  const grok = fs.readFileSync(path.join(home, '.agents/skills/generate-adapter/SKILL.md'), 'utf8');
  assert.match(claude, /name: generate-adapter/);
  assert.doesNotMatch(claude, /```mermaid/);
});

test('sync upserts generate-workflow onto Claude, Grok, and Gemini', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  fs.mkdirSync(path.join(home, '.grok'));
  fs.mkdirSync(path.join(home, '.gemini/antigravity'), { recursive: true });
  applyHostSync({ packageRoot: ROOT, home });
  const claude = fs.readFileSync(path.join(home, '.claude/skills/generate-workflow/SKILL.md'), 'utf8');
  const grok = fs.readFileSync(path.join(home, '.agents/skills/generate-workflow/SKILL.md'), 'utf8');
  const gemini = fs.readFileSync(path.join(home, '.gemini/config/skills/generate-workflow/SKILL.md'), 'utf8');
  assert.match(claude, /name: generate-workflow/);
  assert.doesNotMatch(claude, /```mermaid/);
  assert.match(claude, /lessons\.md/);
  assert.match(gemini, /Do not start Maker/);
});

// Issue #25: help and unknown flags must never write.
function snapshot(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      out.push(path.relative(dir, abs));
      if (entry.isDirectory()) walk(abs);
    }
  };
  walk(dir);
  return out.sort();
}

function runCli(args, { home, cwd }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home },
    encoding: 'utf8'
  });
}

test('help flags and unknown flags on writer commands never write to home or repo', () => {
  const home = tmpHome();
  for (const host of ['.claude', '.grok', '.gemini', '.agents']) fs.mkdirSync(path.join(home, host));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-repo-'));
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo"}\n');
  const beforeHome = snapshot(home);
  const beforeRepo = snapshot(repo);
  const helpCases = [
    ['sync-hosts', '--help'], ['sync-hosts', '-h'], ['sync-hosts', '--dry-run', '--help'],
    ['init', '--help'], ['refresh', '-h'], ['update', 'apply', '--yes', '--help'],
    ['generate-adapter', '--type', 'github', '--help'], ['generate-workflow', '--write', '-h'],
    ['run', '--help']
  ];
  for (const args of helpCases) {
    const result = runCli(args, { home, cwd: repo });
    assert.strictEqual(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`Usage: npx ai-engineering-loop ${args[0]}`), args.join(' '));
  }
  const unknownCases = [
    ['sync-hosts', '--force'], ['sync-hosts', '--dryrun'], ['init', '--yes'], ['refresh', 'now'],
    ['update', 'apply', '--yess'], ['generate-workflow', '--writ'], ['generate-adapter', '--typ', 'github']
  ];
  for (const args of unknownCases) {
    const result = runCli(args, { home, cwd: repo });
    assert.strictEqual(result.status, 2, `${args.join(' ')} should exit 2`);
    assert.match(result.stderr + result.stdout, /Nothing was written/, args.join(' '));
  }
  assert.deepStrictEqual(snapshot(home), beforeHome);
  assert.deepStrictEqual(snapshot(repo), beforeRepo);
});

// Issue #25: user-edited host files are backed up before overwrite.
test('sync backs up user-edited or untracked host files and not files it wrote itself', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  const dest = path.join(home, '.claude/skills/ai-engineering-loop/SKILL.md');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, 'my local notes\n');
  const first = applyHostSync({ packageRoot: ROOT, home, version: '9.9.9' });
  const item = first.find((entry) => entry.dest === dest);
  assert.strictEqual(item.action, 'copy');
  assert.strictEqual(item.backup, true);
  assert.strictEqual(fs.readFileSync(`${dest}.ael-backup`, 'utf8'), 'my local notes\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(home, '.ai-engineering-loop/host-manifest.json'), 'utf8'));
  assert.strictEqual(manifest.version, '9.9.9');
  assert.ok(manifest.files[dest].sha256);

  // A package change over an unmodified managed file needs no backup.
  const plan = planHostSync({ packageRoot: ROOT, home });
  assert.strictEqual(plan.find((entry) => entry.dest === dest).action, 'current');
  fs.rmSync(`${dest}.ael-backup`);
  const managed = JSON.parse(fs.readFileSync(path.join(home, '.ai-engineering-loop/host-manifest.json'), 'utf8'));
  fs.writeFileSync(dest, 'older package text\n');
  managed.files[dest].sha256 = require('crypto').createHash('sha256').update('older package text\n').digest('hex');
  fs.writeFileSync(path.join(home, '.ai-engineering-loop/host-manifest.json'), JSON.stringify(managed));
  const second = applyHostSync({ packageRoot: ROOT, home });
  assert.strictEqual(second.find((entry) => entry.dest === dest).backup, false);
  assert.ok(!fs.existsSync(`${dest}.ael-backup`));

  // A user edit after AEL wrote the file is backed up again.
  fs.appendFileSync(dest, '\nlocal tweak\n');
  const third = applyHostSync({ packageRoot: ROOT, home });
  assert.strictEqual(third.find((entry) => entry.dest === dest).backup, true);
  assert.match(fs.readFileSync(`${dest}.ael-backup`, 'utf8'), /local tweak/);
});

// Issue #31: optional packs.
test('default sync installs only the core pack; packs are opt-in, saved, and prunable', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  const results = applyHostSync({ packageRoot: ROOT, home });
  assert.deepStrictEqual(results.packs, ['core']);
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/ai-engineering-loop/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(home, '.claude/skills/emil-design-eng')));
  assert.ok(!fs.existsSync(path.join(home, '.claude/skills/backend-development')));
  const skippedPacks = new Set(results.filter((item) => item.reason === 'pack-not-selected').map((item) => item.pack));
  assert.deepStrictEqual([...skippedPacks].sort(), ['backend', 'design', 'quality']);

  applyHostSync({ packageRoot: ROOT, home, packs: 'design' });
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/emil-design-eng/SKILL.md')));
  const config = JSON.parse(fs.readFileSync(path.join(home, '.ai-engineering-loop/config.json'), 'utf8'));
  assert.deepStrictEqual(config.hostPacks, ['core', 'design']);
  // Saved selection is reused without arguments.
  assert.deepStrictEqual(planHostSync({ packageRoot: ROOT, home }).packs, ['core', 'design']);

  // Without --prune, deselecting never deletes.
  applyHostSync({ packageRoot: ROOT, home, packs: 'core' });
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/emil-design-eng/SKILL.md')));

  // --prune removes unmodified pack files and keeps edited ones.
  const edited = path.join(home, '.claude/skills/animate/SKILL.md');
  fs.appendFileSync(edited, '\nmine\n');
  const pruned = applyHostSync({ packageRoot: ROOT, home, packs: 'core', prune: true });
  assert.ok(!fs.existsSync(path.join(home, '.claude/skills/emil-design-eng')));
  assert.ok(fs.existsSync(edited));
  assert.strictEqual(pruned.find((item) => item.dest === edited).reason, 'modified');
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/ai-engineering-loop/SKILL.md')));
});

test('legacy installs keep updating an optional pack that is already on disk', () => {
  const home = tmpHome();
  const legacy = path.join(home, '.claude/skills/backend-development/SKILL.md');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, 'old backend skill\n');
  const plan = planHostSync({ packageRoot: ROOT, home });
  assert.deepStrictEqual(plan.packs, ['core', 'backend']);
  assert.strictEqual(plan.packSource, 'detected');
  assert.strictEqual(plan.find((item) => item.dest === legacy).action, 'copy');
});

test('unknown pack names fail before writing', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  assert.throws(() => applyHostSync({ packageRoot: ROOT, home, packs: 'desgin' }), /Unknown host pack/);
  assert.deepStrictEqual(fs.readdirSync(path.join(home, '.claude')), []);
  const result = runCli(['sync-hosts', '--pack', 'nope'], { home, cwd: home });
  assert.strictEqual(result.status, 2);
  assert.deepStrictEqual(fs.readdirSync(path.join(home, '.claude')), []);
});

// Issue #30: run and status never write to home.
test('run does not sync hosts; status --json reports host freshness without writing', () => {
  const home = tmpHome();
  fs.mkdirSync(path.join(home, '.claude'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-repo-'));
  fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"demo","scripts":{"test":"node -e 0"}}\n');
  assert.strictEqual(runCli(['init'], { home, cwd: repo }).status, 0);
  const before = snapshot(home);
  const run = runCli(['run', 'demo task'], { home, cwd: repo });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.deepStrictEqual(snapshot(home), before);
  const status = runCli(['status', '--json'], { home, cwd: repo });
  assert.strictEqual(status.status, 0, status.stderr);
  const parsed = JSON.parse(status.stdout);
  assert.strictEqual(parsed.status, 'READY');
  assert.strictEqual(parsed.hostSkills.stale, true);
  assert.ok(parsed.hostSkills.staleFiles > 0);
  assert.strictEqual(parsed.hostSkills.installedVersion, null);
  assert.deepStrictEqual(snapshot(home), before);
  assert.strictEqual(runCli(['sync-hosts'], { home, cwd: repo }).status, 0);
  const fresh = JSON.parse(runCli(['status', '--json'], { home, cwd: repo }).stdout);
  assert.strictEqual(fresh.hostSkills.stale, false);
  assert.strictEqual(fresh.hostSkills.installedVersion, require('../package.json').version);
});
