'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, afterEach } = require('node:test');

const BIN = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');
const spawned = [];
const homes = [];

function tempDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  homes.push(dir);
  return dir;
}

const studioFile = (home) => path.join(home, '.ai-engineering-loop', 'studio.json');

function env(home) {
  return { ...process.env, AEL_HOME: home, HOME: home };
}

function runCli(home, args, cwd = home) {
  return spawnSync(process.execPath, [BIN, ...args], { env: env(home), cwd, encoding: 'utf8', timeout: 20000 });
}

function startForeground(home) {
  const child = spawn(process.execPath, [BIN, 'studio', '--no-open', '--no-notify', '--port', '0'], {
    env: env(home),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  spawned.push(child);
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`studio did not start: ${out}`)), 10000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/);
      if (match) {
        clearTimeout(timer);
        resolve({ child, url: match[0] });
      }
    });
    child.on('exit', () => reject(new Error(`studio exited early: ${out}`)));
  });
}

function exited(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.on('exit', resolve);
  });
}

afterEach(() => {
  while (spawned.length) {
    const child = spawned.pop();
    try {
      child.kill('SIGKILL');
    } catch {
      continue;
    }
  }
  while (homes.length) {
    const dir = homes.pop();
    const file = studioFile(dir);
    try {
      const { pid } = JSON.parse(fs.readFileSync(file, 'utf8'));
      process.kill(pid, 'SIGKILL');
    } catch {
      continue;
    }
  }
});

test('start prints a tokenised url and writes studio.json', async () => {
  const home = tempDir('ael-studio-cli-');
  const { child, url } = await startForeground(home);
  const stored = JSON.parse(fs.readFileSync(studioFile(home), 'utf8'));
  assert.equal(stored.pid, child.pid);
  assert.match(url, new RegExp(`:${stored.port}/\\?token=`));
  assert.equal(stored.url.includes('token'), false);
});

test('a second start reports already running with the tokenless url', async () => {
  const home = tempDir('ael-studio-cli-');
  await startForeground(home);
  const second = runCli(home, ['studio', '--no-open', '--port', '0']);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /Studio is already running/);
  assert.match(second.stdout, /http:\/\/127\.0\.0\.1:\d+\/\n/);
  assert.equal(second.stdout.includes('token='), false);
});

test('--stop ends the process and removes studio.json', async () => {
  const home = tempDir('ael-studio-cli-');
  const { child } = await startForeground(home);
  const stopper = spawn(process.execPath, [BIN, 'studio', '--stop'], { env: env(home), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  stopper.stdout.on('data', (chunk) => { stdout += chunk; });
  const code = await new Promise((resolve) => stopper.on('exit', resolve));
  assert.equal(code, 0);
  assert.match(stdout, /Studio stopped/);
  await exited(child);
  assert.equal(fs.existsSync(studioFile(home)), false);
});

test('--stop with nothing running says so and exits 0', () => {
  const home = tempDir('ael-studio-cli-');
  const stop = runCli(home, ['studio', '--stop']);
  assert.equal(stop.status, 0);
  assert.match(stop.stdout, /Studio is not running/);
});

test('--background detaches, prints the url, and --stop ends it', () => {
  const home = tempDir('ael-studio-cli-');
  const started = runCli(home, ['studio', '--background', '--no-notify', '--port', '0']);
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/);
  assert.equal(fs.existsSync(studioFile(home)), true);
  assert.equal(fs.existsSync(path.join(home, '.ai-engineering-loop', 'studio.log')), true);
  const { pid } = JSON.parse(fs.readFileSync(studioFile(home), 'utf8'));
  const stop = runCli(home, ['studio', '--stop']);
  assert.match(stop.stdout, /Studio stopped/);
  assert.equal(fs.existsSync(studioFile(home)), false);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

function writeStaleInstance(home, pid, port) {
  fs.mkdirSync(path.dirname(studioFile(home)), { recursive: true });
  fs.writeFileSync(studioFile(home), JSON.stringify({
    schemaVersion: 1, pid, port, url: `http://127.0.0.1:${port}/`, startedAt: new Date().toISOString()
  }));
}

function freePort() {
  const server = require('node:net').createServer();
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('--stop never signals a live pid whose port is not Studio and removes the stale file', async () => {
  const home = tempDir('ael-studio-cli-');
  const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  spawned.push(bystander);
  writeStaleInstance(home, bystander.pid, await freePort());
  const stop = runCli(home, ['studio', '--stop']);
  assert.equal(stop.status, 0);
  assert.match(stop.stdout, /Studio is not running \(removed a stale instance file\)/);
  assert.equal(fs.existsSync(studioFile(home)), false);
  process.kill(bystander.pid, 0);
});

test('status --json shows a studioUrl with ?project= while Studio runs', async () => {
  const home = tempDir('ael-studio-cli-');
  const repo = tempDir('ael-studio-repo-');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  await startForeground(home);
  const status = runCli(home, ['status', '--json'], repo);
  const parsed = JSON.parse(status.stdout);
  assert.match(parsed.studioUrl, /^http:\/\/127\.0\.0\.1:\d+\/\?project=[0-9a-f]{12}$/);
});

test('studio rejects --json before starting anything and help does not offer it', () => {
  const home = tempDir('ael-studio-cli-');
  const started = runCli(home, ['studio', '--json', '--no-open', '--port', '0']);
  assert.equal(started.status, 2);
  assert.match(started.stdout, /Unknown argument\(s\) for "studio": --json\. Nothing was written\./);
  assert.equal(fs.existsSync(studioFile(home)), false);
  const help = runCli(home, ['studio', '--help']);
  assert.match(help.stdout, /\[--port <0-65535>\] \[--no-open\] \[--no-notify\]\n/);
});

test('--background never writes the session token to the log, and the log is private', () => {
  const home = tempDir('ael-studio-cli-');
  const logFile = path.join(home, '.ai-engineering-loop', 'studio.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, 'é older line\n', { mode: 0o644 });
  fs.chmodSync(logFile, 0o644);
  const started = runCli(home, ['studio', '--background', '--no-notify', '--port', '0']);
  assert.equal(started.status, 0, started.stderr);
  const token = started.stdout.match(/\?token=(\S+)/)[1];
  const log = fs.readFileSync(logFile, 'utf8');
  assert.equal(log.includes(token), false);
  assert.equal(log.includes('token='), false);
  assert.match(log, /http:\/\/127\.0\.0\.1:\d+\//);
  assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);
  runCli(home, ['studio', '--stop']);
});

test('--background that cannot start shows the new log lines intact after multibyte history', async () => {
  const home = tempDir('ael-studio-cli-');
  const logFile = path.join(home, '.ai-engineering-loop', 'studio.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, `${'é'.repeat(40)}\n`);
  const blocker = require('node:net').createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  try {
    const started = runCli(home, ['studio', '--background', '--no-notify', '--port', String(blocker.address().port)]);
    assert.equal(started.status, 1);
    assert.match(started.stderr, /Unable to start Studio: .*EADDRINUSE/);
    assert.equal(started.stderr.includes('é'), false);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});
