'use strict';

// Regression tests for the 2026-10-20 security/robustness audit.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { hashFile } = require('../lib/gates.js');
const { checkGuard, destructiveFindings, hookFailureExitCode } = require('../lib/guard.js');
const { CLAUDE_COMMAND, installHooks } = require('../lib/guard-hooks.js');
const { compileRecipe, loadRecipe } = require('../lib/recipe.js');
const { appendRunLifecycle, listRunLifecycle } = require('../lib/run-lifecycle.js');
const {
  atomicWriteJson,
  createRun,
  loadRun,
  runsDir,
  transitionRun,
  updateRunDisplayName,
  withFileLock
} = require('../lib/run-state.js');
const { createRunWatcher } = require('../lib/run-watcher.js');
const { redactSecrets } = require('../lib/safe-context.js');
const { resolveSpawn } = require('../lib/spawn-command.js');
const { createStudioServer } = require('../lib/studio-server.js');
const { recordVerificationCommand } = require('../lib/verification-recorder.js');
const { createWorkflowBundle, loadWorkflow, startWorkflowNode } = require('../lib/workflow-runtime.js');
const { version } = require('../package.json');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function tempDir(prefix = 'ael-audit-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function lifecycleEvent(message) {
  return { type: 'AGENT_HEARTBEAT', phase: 'maker', actor: 'agent', message };
}

function gatedRepo() {
  const root = tempDir();
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  createRun(root, { runId: 'run-001', task: 'audit fixture' });
  const diffPath = path.join(runsDir(root), 'run-001', 'diff.patch');
  fs.writeFileSync(diffPath, 'diff --git a/a.js b/a.js\n+const value = 1;\n');
  transitionRun(root, 'run-001', 'GOAL_FROZEN', { gate: 'goal' });
  transitionRun(root, 'run-001', 'MAKER_COMPLETE', {
    gate: 'maker',
    artifacts: { diff: { path: path.relative(root, diffPath).split(path.sep).join('/'), sha256: hashFile(diffPath) } }
  });
  return root;
}

async function withStudio(operation) {
  const root = tempDir('ael-audit-studio-');
  const instance = createStudioServer(root, { token: 'audit-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = instance.server.address();
    await operation(`http://127.0.0.1:${port}`, root);
  } finally {
    instance.watcher.stop();
    await new Promise((resolve) => instance.server.close(resolve));
  }
}

// 1. Studio CSRF
test('Studio rejects cookie-only cross-origin mutations and non-JSON bodies', async () => {
  await withStudio(async (base) => {
    const cookie = 'ael_studio=audit-token';
    const body = JSON.stringify({});
    const crossOrigin = await fetch(`${base}/api/install`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body
    });
    assert.equal(crossOrigin.status, 403);
    const noOrigin = await fetch(`${base}/api/install`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body
    });
    assert.equal(noOrigin.status, 403);
    const formPost = await fetch(`${base}/api/install`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'text/plain', origin: base },
      body
    });
    assert.equal(formPost.status, 415);
    const tokenTextPost = await fetch(`${base}/api/install`, {
      method: 'POST',
      headers: { 'x-ael-studio-token': 'audit-token', 'content-type': 'text/plain' },
      body
    });
    assert.equal(tokenTextPost.status, 415);

    const sameOrigin = await fetch(`${base}/api/install`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json; charset=utf-8', origin: base },
      body
    });
    assert.ok(![401, 403, 415].includes(sameOrigin.status), `same-origin status ${sameOrigin.status}`);
    const tokenHeader = await fetch(`${base}/api/install`, {
      method: 'POST',
      headers: { 'x-ael-studio-token': 'audit-token', 'content-type': 'application/json' },
      body
    });
    assert.ok(![401, 403, 415].includes(tokenHeader.status), `token status ${tokenHeader.status}`);
    const read = await fetch(`${base}/api/bootstrap`, { headers: { cookie } });
    assert.equal(read.status, 200, 'cookie-only reads keep working');
  });
});

// 2. Redaction gaps
test('redactSecrets covers JSON keys, embedded key names, and common token formats', () => {
  const cases = {
    '{"password":"hunter2"}': 'hunter2',
    '{ "password" : "hunter2" }': 'hunter2',
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY': 'wJalrXUtnFEMI',
    '_password: s3cr3t-value': 's3cr3t-value',
    'clientSecret="abc123def"': 'abc123def',
    'NPM_TOKEN npm_abcdefghijklmnopqrstuvwxyz0123456789': 'npm_abcdefghij',
    'key sk_live_51Habcdefghijklmnop': 'sk_live_51H',
    'slack xoxb-123456789012-abcdefghijkl': 'xoxb-1234',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U': 'dozjgNry',
    'DATABASE_URL=postgres://app:p4ssw0rd@db.internal:5432/app': 'p4ssw0rd',
    'see https://deploy:tok3n@example.com/repo.git': 'tok3n'
  };
  for (const [input, secret] of Object.entries(cases)) {
    const result = redactSecrets(input);
    assert.ok(!result.text.includes(secret), `${input} -> ${result.text}`);
    assert.ok(result.categories.length > 0, input);
    assert.deepEqual(redactSecrets(result.text).categories, [], `redaction is idempotent for ${input}`);
  }
  for (const benign of ['maxEstimatedTokens: 12000', '"input_tokens": 5', 'https://github.com/org/repo', 'mail me@example.com']) {
    assert.deepEqual(redactSecrets(benign).categories, [], benign);
  }
});

// 3. Guard
test('guard denies edits to CLI-owned Run evidence but keeps agent artifacts writable', () => {
  const root = tempDir();
  createRun(root, { runId: 'run-001', task: 'guard', mode: 'UNATTENDED' });
  const edit = (target) => checkGuard(root, { tool: 'edit', input: { tool_name: 'Write', tool_input: { file_path: target } } });
  for (const target of [
    '.ai-engineering-loop/runs/run-001/verification.json',
    '.ai-engineering-loop/runs/run-001/state.json',
    '.ai-engineering-loop/runs/run-001/events.jsonl',
    '.ai-engineering-loop/runs/current.json',
    path.join(root, '.ai-engineering-loop', 'runs', 'run-001', 'verification-summary.json')
  ]) {
    const result = edit(target);
    assert.equal(result.decision, 'block', target);
    assert.deepEqual(result.rules, ['run-evidence'], target);
  }
  assert.equal(edit('.ai-engineering-loop/runs/run-001/findings.json').decision, 'allow');
  assert.equal(edit('.ai-engineering-loop/architecture.md').decision, 'allow');
});

test('guard detects alias bypasses and more destructive git/find commands', () => {
  const cases = {
    '\\rm -rf build': 'rm-recursive-force',
    '"rm" -rf build': 'rm-recursive-force',
    'sleep 1 & rm -rf build': 'rm-recursive-force',
    'find . -name "*.js" -delete': 'find-delete',
    'find . -type f -exec rm {} +': 'find-delete',
    'git checkout -- .': 'git-checkout-discard',
    'git checkout .': 'git-checkout-discard',
    'git checkout -f main': 'git-checkout-discard',
    'git restore src/app.js': 'git-restore',
    'git restore --worktree --staged .': 'git-restore',
    'git branch -D feature': 'git-branch-force-delete',
    'git branch --delete --force feature': 'git-branch-force-delete'
  };
  for (const [command, rule] of Object.entries(cases)) {
    assert.deepEqual(destructiveFindings(command).map((item) => item.id), [rule], command);
  }
  for (const command of ['git checkout main', 'git checkout -b topic', 'git restore --staged src/app.js', 'git branch -d merged', 'find . -name "*.js"', 'npm test 2>&1']) {
    assert.deepEqual(destructiveFindings(command), [], command);
  }
});

test('guard hook failures fail closed outside ASSISTED and the hook command is version-pinned', () => {
  const unattended = tempDir();
  createRun(unattended, { runId: 'run-001', task: 'guard', mode: 'UNATTENDED' });
  fs.writeFileSync(path.join(runsDir(unattended), 'current.json'), JSON.stringify({ schemaVersion: 1, runId: 'run-001' }));
  assert.equal(hookFailureExitCode(unattended), 2);
  const hook = spawnSync(process.execPath, [CLI, 'guard', 'check', '--hook', 'claude'], {
    cwd: unattended, input: 'not json', encoding: 'utf8'
  });
  assert.equal(hook.status, 2, hook.stderr);

  const assisted = tempDir();
  createRun(assisted, { runId: 'run-001', task: 'guard', mode: 'ASSISTED' });
  fs.writeFileSync(path.join(runsDir(assisted), 'current.json'), JSON.stringify({ schemaVersion: 1, runId: 'run-001' }));
  assert.equal(hookFailureExitCode(assisted), 1);

  assert.equal(CLAUDE_COMMAND, `npx --yes ai-engineering-loop@${version} guard check --hook claude`);
  const repo = tempDir();
  const settings = path.join(repo, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings));
  fs.writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'npx --yes ai-engineering-loop guard check --hook claude' }] }] } }));
  assert.equal(installHooks(repo).changed, true, 'legacy unpinned hooks are re-pinned');
  const written = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(written.hooks.PreToolUse.length, 1);
  assert.equal(written.hooks.PreToolUse[0].hooks[0].command, CLAUDE_COMMAND);
  assert.equal(installHooks(repo).changed, false);
});

// 4. Timeout kills the whole process tree
test('verification timeout stops grandchildren that hold the output pipes', async () => {
  const root = gatedRepo();
  const script = [
    "const { spawn } = require('child_process');",
    "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
    'setInterval(() => {}, 1000);'
  ].join('\n');
  const started = Date.now();
  const result = await recordVerificationCommand(root, {
    runId: 'run-001',
    command: process.execPath,
    args: ['-e', script],
    timeoutMs: 500
  });
  assert.equal(result.command.timeoutStatus, 'TIMED_OUT');
  assert.ok(Date.now() - started < 8_000, `took ${Date.now() - started} ms`);
});

// 5. Lost updates
test('concurrent verification records keep every command result', async () => {
  const root = gatedRepo();
  const slow = recordVerificationCommand(root, {
    runId: 'run-001',
    command: process.execPath,
    args: ['-e', 'setTimeout(() => console.log("slow"), 600)']
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await recordVerificationCommand(root, { runId: 'run-001', command: process.execPath, args: ['-e', 'console.log("fast")'] });
  await slow;
  const bundle = JSON.parse(fs.readFileSync(path.join(runsDir(root), 'run-001', 'verification.json'), 'utf8'));
  assert.deepEqual(bundle.commands.map((item) => item.stdout.trim()).sort(), ['fast', 'slow']);
});

test('run state updates take a lock, wait for a live holder, and steal a stale one', () => {
  const root = tempDir();
  createRun(root, { runId: 'run-001', task: 'lock' });
  const lock = path.join(runsDir(root), 'run-001', 'state.json.lock');
  fs.writeFileSync(lock, '1\n');
  assert.throws(() => withFileLock(lock, () => 'never', { waitMs: 50 }), { code: 'RUN_STATE_BUSY' });
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(lock, old, old);
  const renamed = updateRunDisplayName(root, 'run-001', 'Renamed run');
  assert.equal(renamed.displayName, 'Renamed run');
  assert.ok(!fs.existsSync(lock), 'lock is released');
  const next = transitionRun(root, 'run-001', 'GOAL_FROZEN', { gate: 'goal' });
  assert.equal(next.displayName, 'Renamed run', 'transition re-reads state written by another writer');
  assert.equal(loadRun(root, 'run-001').history.length, next.history.length);
  assert.ok(!fs.existsSync(path.join(runsDir(root), 'missing-run')));
  assert.throws(() => transitionRun(root, 'missing-run', 'GOAL_FROZEN'));
  assert.ok(!fs.existsSync(path.join(runsDir(root), 'missing-run')), 'locking never creates Run directories');
});

// 6. Torn trailing lines
test('a torn trailing lifecycle line is tolerated and quarantined on the next append', () => {
  const root = tempDir();
  createRun(root, { runId: 'run-001', task: 'torn' });
  appendRunLifecycle(root, 'run-001', lifecycleEvent('first'));
  const file = path.join(runsDir(root), 'run-001', 'lifecycle.jsonl');
  fs.appendFileSync(file, '{"schemaVersion":1,"runId":"run-0');
  assert.deepEqual(listRunLifecycle(root, 'run-001').events.map((event) => event.message), ['first']);
  const second = appendRunLifecycle(root, 'run-001', lifecycleEvent('second'));
  assert.equal(second.sequence, 2);
  assert.deepEqual(listRunLifecycle(root, 'run-001').events.map((event) => event.sequence), [1, 2]);
  const quarantined = fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith('lifecycle.jsonl.torn-'));
  assert.equal(quarantined.length, 1);
  assert.match(fs.readFileSync(path.join(path.dirname(file), quarantined[0]), 'utf8'), /run-0$/);
});

test('a torn trailing workflow event does not brick the Run', () => {
  const root = tempDir();
  const plan = compileRecipe(loadRecipe(root, 'default').recipe, { mode: 'ASSISTED' });
  const workflow = createWorkflowBundle(plan, 'run-001', {
    run: { runId: 'run-001', mode: 'ASSISTED', state: 'STARTED', iteration: 1, task: 'torn' }
  });
  createRun(root, { runId: 'run-001', mode: 'ASSISTED', task: 'torn', workflow });
  const events = path.join(runsDir(root), 'run-001', 'events.jsonl');
  fs.appendFileSync(events, '{"sequence":2,"type":"NODE_STA');
  assert.equal(loadWorkflow(root, 'run-001').events.length, 1);
  startWorkflowNode(root, 'goal', { runId: 'run-001' });
  const reloaded = loadWorkflow(root, 'run-001');
  assert.equal(reloaded.events.length, 2);
  assert.ok(fs.readFileSync(events, 'utf8').endsWith('\n'));
});

// 7. Windows command resolution and rename retries
test('resolveSpawn runs Windows .cmd shims through cmd.exe and keeps .exe direct', () => {
  const bin = tempDir();
  fs.writeFileSync(path.join(bin, 'npm.cmd'), '@echo off\n');
  fs.writeFileSync(path.join(bin, 'git.exe'), '');
  const env = { PATH: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
  const npm = resolveSpawn('npm', ['install', '--global', 'pkg@1.2.3'], { platform: 'win32', env });
  assert.equal(npm.command, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepEqual(npm.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.ok(npm.args[3].includes('npm.cmd'));
  assert.ok(npm.args[3].includes('^"pkg@1.2.3^"'));
  assert.equal(npm.options.windowsVerbatimArguments, true);
  const git = resolveSpawn('git', ['status'], { platform: 'win32', env });
  assert.equal(git.command, path.join(bin, 'git.exe'));
  assert.deepEqual(git.args, ['status']);
  assert.deepEqual(resolveSpawn('npm', ['test'], { platform: 'linux', env }), { command: 'npm', args: ['test'], options: {} });
});

test('atomic writes retry a transient EPERM/EBUSY rename', () => {
  const root = tempDir();
  const target = path.join(root, 'state.json');
  const original = fs.renameSync;
  let failures = 0;
  fs.renameSync = (...args) => {
    if (failures < 2) {
      failures += 1;
      throw Object.assign(new Error('busy'), { code: failures === 1 ? 'EPERM' : 'EBUSY' });
    }
    return original(...args);
  };
  try {
    atomicWriteJson(target, { ok: true });
  } finally {
    fs.renameSync = original;
  }
  assert.equal(failures, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { ok: true });
});

// 8. Lifecycle cursors and snapshots use the newest events
test('lifecycle snapshots and watcher cursors start from the newest events', async () => {
  const root = tempDir();
  createRun(root, { runId: 'run-001', task: 'cursor' });
  for (let index = 1; index <= 120; index += 1) appendRunLifecycle(root, 'run-001', lifecycleEvent(`event ${index}`));
  const latest = listRunLifecycle(root, 'run-001', { after: 0, limit: 100, latest: true });
  assert.equal(latest.events[0].sequence, 21);
  assert.equal(latest.nextSequence, 120);

  const watcher = createRunWatcher(root, { watch: false, pollMs: 20, debounceMs: 0 });
  const published = [];
  watcher.subscribe((event) => { if (event.type === 'lifecycle') published.push(event); });
  watcher.start();
  try {
    appendRunLifecycle(root, 'run-001', lifecycleEvent('event 121'));
    const deadline = Date.now() + 5_000;
    while (!published.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(published.length, 'watcher published the new event');
    assert.deepEqual(published.flatMap((event) => event.payload.events.map((item) => item.sequence)), [121]);
  } finally {
    watcher.stop();
  }

  await withStudio(async (base, studioRoot) => {
    createRun(studioRoot, { runId: 'run-001', task: 'cursor' });
    for (let index = 1; index <= 105; index += 1) appendRunLifecycle(studioRoot, 'run-001', lifecycleEvent(`event ${index}`));
    const response = await fetch(`${base}/api/live?runId=run-001`, { headers: { 'x-ael-studio-token': 'audit-token' } });
    const body = await response.json();
    assert.equal(body.live.lifecycle.events.at(-1).sequence, 105);
    assert.equal(body.live.lifecycle.events.length, 100);
  });
});
