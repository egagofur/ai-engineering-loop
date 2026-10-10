'use strict';

// Issue #49: data-driven host registry, detection, setup, hosts enable/disable.
// Every test uses a temporary HOME; nothing touches the real home directory.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-engineering-loop.js');
const { HOSTS, HOST_IDS, SHARED_SKILLS_DIR, usesSharedSkills } = require('../lib/hosts/registry.js');
const { detectHosts, findOnPath } = require('../lib/hosts/detect.js');
const { FORMATS, renderAgent, agentSpec } = require('../lib/hosts/agent-formats.js');
const { applyHostSync, resolveHostSelection } = require('../lib/sync-hosts.js');
const hostCommands = require('../lib/hosts/commands.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// An executable stub that leaves a marker if anything ever runs it.
function stubBin(names) {
  const dir = tmp('ael-bin-');
  const marker = path.join(dir, 'EXECUTED');
  for (const name of names) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\necho ran > "${marker}"\n`);
    fs.chmodSync(file, 0o755);
  }
  return { dir, marker };
}

function cli(home, args, { pathDirs = [], input } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: home,
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      AEL_HOME: home,
      AEL_NO_AUTO_UPDATE: '1',
      PATH: [...pathDirs, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter)
    }
  });
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

test('registry schema: unique ids, known formats, official docs, verification date', () => {
  assert.strictEqual(new Set(HOST_IDS).size, HOST_IDS.length);
  for (const host of HOSTS) {
    assert.match(host.id, /^[a-z][a-z0-9-]*$/, host.id);
    assert.ok(host.name, host.id);
    assert.ok(host.detect.dirs.length + (host.detect.bins || []).length > 0, `${host.id} needs a detection signal`);
    assert.ok(host.detect.dirs.every((d) => !path.isAbsolute(d) && !d.includes('..')), host.id);
    assert.ok(host.skills === 'shared' || (host.skills && typeof host.skills.dir === 'string'), host.id);
    const location = usesSharedSkills(host) ? SHARED_SKILLS_DIR : host.skills.dir;
    assert.ok(host.reads.includes(location), `${host.id} must read where AEL installs its skill`);
    if (host.agents) assert.ok(FORMATS[host.agents.format], `${host.id}: unknown format ${host.agents.format}`);
    assert.ok(host.docs.length > 0 && host.docs.every((url) => url.startsWith('https://')), host.id);
    assert.match(host.verified, /^\d{4}-\d{2}-\d{2}$/, host.id);
  }
  for (const id of ['claude', 'codex', 'gemini', 'antigravity', 'grok', 'cursor', 'copilot']) {
    assert.ok(HOST_IDS.includes(id), `Tier 1 host ${id} missing`);
  }
});

test('detection: config dir alone, PATH binary alone, and binaries are never executed', () => {
  const home = tmp('ael-detect-');
  fs.mkdirSync(path.join(home, '.claude'));
  const { dir, marker } = stubBin(['codex']);
  fs.writeFileSync(path.join(dir, 'gemini'), 'not executable\n', { mode: 0o644 });
  const found = new Map(detectHosts({ home, env: { PATH: dir } }).map((d) => [d.id, d]));
  assert.deepStrictEqual(found.get('claude').dirs, ['.claude']);
  assert.strictEqual(found.get('claude').detected, true);
  assert.strictEqual(found.get('codex').detected, true);
  assert.deepStrictEqual(found.get('codex').bins, [path.join(dir, 'codex')]);
  assert.strictEqual(found.get('gemini').detected, false, 'a non-executable file is not a binary');
  assert.strictEqual(found.get('grok').detected, false);
  assert.strictEqual(findOnPath('codex', { PATH: '' }), null);
  assert.ok(!fs.existsSync(marker), 'detection must never run a binary');
  // CLI listing goes through the same path and must not run it either.
  const listed = cli(home, ['hosts', 'list', '--json'], { pathDirs: [dir] });
  assert.strictEqual(listed.status, 0, listed.stderr);
  const rows = JSON.parse(listed.stdout).hosts;
  assert.deepStrictEqual(rows.find((r) => r.id === 'codex').via, ['PATH:codex']);
  assert.ok(!fs.existsSync(marker));
});

test('before setup, a sync only writes hosts with a config folder (PATH-only hosts wait for setup)', () => {
  const home = tmp('ael-legacy-');
  fs.mkdirSync(path.join(home, '.claude'));
  const { dir } = stubBin(['codex', 'copilot']);
  const result = cli(home, ['sync-hosts'], { pathDirs: [dir] });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/ai-engineering-loop/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(home, '.codex')));
  assert.ok(!fs.existsSync(path.join(home, '.agents')));
  assert.strictEqual(resolveHostSelection(home).source, 'legacy-dirs');
});

test('agent formats: one body everywhere, host frontmatter only', () => {
  for (const name of ['devil-advocate', 'judge']) {
    const spec = agentSpec(ROOT, name);
    const toml = renderAgent(ROOT, 'codex-toml', name);
    assert.match(toml, new RegExp(`^name = "${name}"$`, 'm'));
    assert.match(toml, /^description = ".+"$/m);
    assert.match(toml, /^sandbox_mode = "read-only"$/m);
    assert.ok(toml.includes(`developer_instructions = '''\n${spec.body}'''`));
    for (const [format, field] of [['gemini-md', /^kind: local$/m], ['cursor-md', /^readonly: true$/m], ['copilot-agent-md', /^description: /m], ['antigravity-md', /^subagent: true$/m]]) {
      const text = renderAgent(ROOT, format, name);
      assert.match(text, new RegExp(`^---\\nname: ${name}\\n`), format);
      assert.match(text, field, format);
      assert.ok(text.endsWith(spec.body), `${format} body must be the shared body`);
    }
  }
  assert.strictEqual(FORMATS['copilot-agent-md'].file('judge'), 'judge.agent.md');
  assert.strictEqual(FORMATS['codex-toml'].file('judge'), 'judge.toml');
});

test('every enabled host sees exactly one copy, or byte-identical copies, of each skill', () => {
  const home = tmp('ael-onecopy-');
  const selection = { enabled: new Set(HOST_IDS), disabled: new Set(), source: 'config', mode: 'manual' };
  applyHostSync({ packageRoot: ROOT, home, hosts: selection, packs: ['backend', 'design', 'quality'] });
  for (const host of HOSTS) {
    const seen = new Map();
    for (const dir of host.reads) {
      const abs = path.join(home, dir);
      if (!fs.existsSync(abs)) continue;
      for (const name of fs.readdirSync(abs)) {
        const file = path.join(abs, name, 'SKILL.md');
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (seen.has(name)) assert.strictEqual(text, seen.get(name), `${host.id}: ${name} differs between folders it reads`);
        else seen.set(name, text);
      }
    }
    assert.ok(seen.has('ai-engineering-loop'), `${host.id} does not see the loop skill`);
    if (host.agents) {
      for (const name of ['devil-advocate', 'judge']) {
        assert.ok(fs.existsSync(path.join(home, host.agents.dir, FORMATS[host.agents.format].file(name))), `${host.id} ${name}`);
      }
    }
  }
  // Hosts on the shared folder never get a private copy.
  assert.ok(!fs.existsSync(path.join(home, '.grok/skills')));
  assert.ok(!fs.existsSync(path.join(home, '.codex/skills')));
  assert.ok(!fs.existsSync(path.join(home, '.gemini/skills')));
});

test('setup without a TTY and without --yes writes nothing; --yes enables detected hosts', () => {
  const home = tmp('ael-setup-');
  fs.mkdirSync(path.join(home, '.claude'));
  const { dir, marker } = stubBin(['codex']);
  const dry = cli(home, ['setup', '--json'], { pathDirs: [dir] });
  assert.strictEqual(dry.status, 0, dry.stderr);
  const plan = JSON.parse(dry.stdout);
  assert.strictEqual(plan.wrote, false);
  assert.deepStrictEqual(plan.wouldEnable, ['claude', 'codex']);
  assert.deepStrictEqual(listFiles(home), ['.claude'], 'non-interactive setup must not write');
  const done = cli(home, ['setup', '--yes', '--json'], { pathDirs: [dir] });
  assert.strictEqual(done.status, 0, done.stderr);
  const out = JSON.parse(done.stdout);
  assert.deepStrictEqual(out.enabled, ['claude', 'codex']);
  assert.strictEqual(out.mode, 'manual', 'non-interactive setup defaults to manual');
  assert.ok(fs.existsSync(path.join(home, '.codex/agents/devil-advocate.toml')));
  assert.ok(fs.existsSync(path.join(home, '.agents/skills/ai-engineering-loop/SKILL.md')));
  assert.ok(!fs.existsSync(marker));
  const config = JSON.parse(fs.readFileSync(path.join(home, '.ai-engineering-loop/config.json'), 'utf8'));
  assert.deepStrictEqual(config.hosts.enabled, ['claude', 'codex']);
  assert.ok(config.hosts.setupAt);
});

test('hosts disable removes unedited AEL files (manifest), keeps edited ones and files still in use', () => {
  const home = tmp('ael-disable-');
  assert.strictEqual(cli(home, ['setup', '--yes', '--hosts', 'codex,gemini,claude']).status, 0);
  const editedAgent = path.join(home, '.codex/agents/judge.toml');
  fs.appendFileSync(editedAgent, '# my tweak\n');
  // Gemini still reads ~/.agents/skills, so disabling Codex keeps the shared copy.
  let result = cli(home, ['hosts', 'disable', 'codex']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(path.join(home, '.codex/agents/devil-advocate.toml')));
  assert.ok(fs.readFileSync(editedAgent, 'utf8').endsWith('# my tweak\n'), 'edited file kept');
  assert.ok(fs.existsSync(path.join(home, '.agents/skills/ai-engineering-loop/SKILL.md')));
  // Last shared-folder host off: the shared copy goes too (Claude keeps its own).
  result = cli(home, ['hosts', 'disable', 'gemini']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(path.join(home, '.agents/skills/ai-engineering-loop/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(home, '.gemini/agents/judge.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude/skills/ai-engineering-loop/SKILL.md')));
  const manifest = JSON.parse(fs.readFileSync(path.join(home, '.ai-engineering-loop/host-manifest.json'), 'utf8'));
  assert.ok(!Object.keys(manifest.files).some((f) => f.includes(`${path.sep}.agents${path.sep}`)), 'manifest forgets pruned files');
  // Re-enable restores; the edited file is backed up before it is overwritten.
  result = cli(home, ['hosts', 'enable', 'codex', '--json']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(home, '.codex/agents/devil-advocate.toml')));
  assert.ok(fs.existsSync(`${editedAgent}.ael-backup`));
  assert.deepStrictEqual(JSON.parse(result.stdout).hosts, ['claude', 'codex']);
});

test('enable/disable before setup start from what is synced today', () => {
  const home = tmp('ael-enable-legacy-');
  fs.mkdirSync(path.join(home, '.claude'));
  const result = cli(home, ['hosts', 'enable', 'cursor']);
  assert.strictEqual(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(home, '.ai-engineering-loop/config.json'), 'utf8'));
  assert.deepStrictEqual(config.hosts.enabled, ['claude', 'cursor']);
  assert.ok(fs.existsSync(path.join(home, '.cursor/agents/judge.md')));
});

test('--help, unknown flags, and unknown host ids write nothing', () => {
  const home = tmp('ael-nowrite-');
  fs.mkdirSync(path.join(home, '.claude'));
  for (const args of [
    ['setup', '--help'],
    ['hosts', '--help'],
    ['hosts', 'enable', 'codex', '--help'],
    ['setup', '--yes', '--bogus'],
    ['hosts', 'enable', 'not-a-host'],
    ['hosts', 'enable'],
    ['hosts', 'frobnicate'],
    ['setup', '--yes', '--hosts', 'nope'],
    ['setup', '--yes', '--mode', 'sometimes']
  ]) {
    const result = cli(home, args);
    assert.ok(result.status === 0 || result.status === 2, `${args.join(' ')}: ${result.status}`);
    assert.deepStrictEqual(listFiles(home), ['.claude'], `${args.join(' ')} wrote files`);
  }
});

test('no npm lifecycle script writes to HOME: setup replaces postinstall', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.ok(!pkg.scripts[hook], `package.json must not define ${hook}`);
  }
});

test('parseHostIds accepts lists and rejects unknown ids', () => {
  assert.deepStrictEqual(hostCommands.parseHostIds('claude, codex,claude'), ['claude', 'codex']);
  assert.deepStrictEqual(hostCommands.parseHostIds(['grok', 'cursor,copilot']), ['grok', 'cursor', 'copilot']);
  assert.throws(() => hostCommands.parseHostIds('aider'), /Unknown host/);
});
