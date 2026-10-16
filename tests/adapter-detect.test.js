'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const {
  detectAdapter,
  parseRemotes,
  remoteHost,
  typeFromRemote
} = require('../lib/adapter-detect.js');
const { detectAdapterHints } = require('../lib/generate-adapter.js');
const { bootstrap } = require('../lib/studio-server.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const DOT_REMOTE = 'git@gitlab.dot.co.id:team/app.git';

function sandboxEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-detect-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, AEL_HOME: home, AEL_NO_AUTO_UPDATE: '1' };
  delete env.CI;
  return env;
}

function gitRepo({ remotes = [], files = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-detect-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  for (const [name, url] of remotes) execFileSync('git', ['remote', 'add', name, url], { cwd: dir });
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'x\n');
  }
  return dir;
}

function worktreeOf(dir) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-detect-wt-')), 'wt');
  execFileSync('git', ['worktree', 'add', '-q', wt], { cwd: dir });
  assert.ok(fs.statSync(path.join(wt, '.git')).isFile(), 'worktree .git is a file');
  return wt;
}

function initType(dir) {
  const result = spawnSync(process.execPath, [CLI, 'init'], { cwd: dir, env: sandboxEnv(), encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const text = fs.readFileSync(path.join(dir, '.ai-engineering-loop', 'adapter.md'), 'utf8');
  return text.match(/adapter_type\*\*: "([a-z-]+)"/)[1];
}

function generateAdapterType(dir) {
  const out = execFileSync(process.execPath, [CLI, 'generate-adapter'], { cwd: dir, env: sandboxEnv(), encoding: 'utf8' });
  return out.match(/- recommended: ([a-z-]+)/)[1];
}

const FIXTURES = [
  { name: 'github', expected: 'github', make: () => gitRepo({ remotes: [['origin', 'git@github.com:acme/app.git']] }) },
  { name: 'gitlab', expected: 'gitlab', make: () => gitRepo({ remotes: [['origin', 'https://gitlab.com/acme/app.git']] }) },
  { name: 'gitlab.dot.co.id', expected: 'dot', make: () => gitRepo({ remotes: [['origin', DOT_REMOTE]] }) },
  { name: 'no-remote', expected: 'standard', make: () => gitRepo() },
  { name: 'worktree', expected: 'dot', make: () => worktreeOf(gitRepo({ remotes: [['origin', DOT_REMOTE]] })) }
];

for (const fixture of FIXTURES) {
  test(`init, generate-adapter and Studio agree: ${fixture.name} -> ${fixture.expected}`, () => {
    const dir = fixture.make();
    assert.strictEqual(detectAdapter(dir).type, fixture.expected);
    assert.strictEqual(generateAdapterType(dir), fixture.expected);
    assert.strictEqual(bootstrap(dir).adapters.recommended, fixture.expected);
    assert.strictEqual(initType(dir), fixture.expected);
  });
}

test('remote wins over CI files: GitHub remote without workflows is github, DOT remote with .gitlab-ci.yml is dot', () => {
  assert.strictEqual(detectAdapter(gitRepo({ remotes: [['origin', 'https://github.com/acme/app.git']] })).type, 'github');
  const dot = detectAdapter(gitRepo({ remotes: [['origin', DOT_REMOTE]], files: ['.gitlab-ci.yml'] }));
  assert.strictEqual(dot.type, 'dot');
  assert.strictEqual(dot.ciProvider, 'GitLab CI');
  assert.match(dot.reason, /remote origin/);
});

test('CI files decide only when the remote host is unknown or missing', () => {
  const selfHosted = gitRepo({ remotes: [['origin', 'git@git.example.com:acme/app.git']], files: ['.gitlab-ci.yml'] });
  assert.deepStrictEqual(
    { type: detectAdapter(selfHosted).type, reason: detectAdapter(selfHosted).reason },
    { type: 'gitlab', reason: 'CI: GitLab CI' }
  );
  assert.strictEqual(detectAdapter(gitRepo({ files: ['.github/workflows/ci.yml'] })).type, 'github');
  assert.strictEqual(detectAdapter(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-detect-nogit-'))).type, 'standard');
});

test('origin is preferred over the first url = line; otherwise the first remote is used', () => {
  const dir = gitRepo({ remotes: [['upstream', 'git@github.com:other/app.git'], ['origin', DOT_REMOTE]] });
  const result = detectAdapter(dir);
  assert.strictEqual(result.type, 'dot');
  assert.strictEqual(result.remote, DOT_REMOTE);
  const noOrigin = gitRepo({ remotes: [['upstream', 'git@github.com:other/app.git']] });
  assert.strictEqual(detectAdapter(noOrigin).type, 'github');
  assert.strictEqual(detectAdapterHints(dir).recommended, 'dot');
});

test('parseRemotes ignores url keys outside [remote] sections', () => {
  const text = '[submodule "lib"]\n\turl = git@github.com:x/lib.git\n[remote "origin"]\n\turl = https://gitlab.com/a/b.git\n';
  assert.deepStrictEqual(parseRemotes(text), [{ name: 'origin', url: 'https://gitlab.com/a/b.git' }]);
});

test('remoteHost and typeFromRemote handle scp, ssh and https URLs by exact host', () => {
  assert.strictEqual(remoteHost('git@github.com:acme/app.git'), 'github.com');
  assert.strictEqual(remoteHost('ssh://git@gitlab.com:2222/acme/app.git'), 'gitlab.com');
  assert.strictEqual(remoteHost('https://user@GitHub.com/acme/app'), 'github.com');
  assert.strictEqual(typeFromRemote(DOT_REMOTE), 'dot');
  assert.strictEqual(typeFromRemote('https://github.com.evil.example/acme/app.git'), null);
  assert.strictEqual(typeFromRemote('https://gitlab.example.com/acme/app.git'), 'gitlab');
  assert.strictEqual(typeFromRemote(''), null);
});
