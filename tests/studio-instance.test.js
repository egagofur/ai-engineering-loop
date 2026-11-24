'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  projectId,
  writeInstance,
  readInstance,
  clearInstance,
  clearInstanceIfOwned,
  readStudioUrl
} = require('../lib/studio/instance.js');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-instance-'));
}

const file = (home) => path.join(home, '.ai-engineering-loop', 'studio.json');

test('write then read returns the same port and url', () => {
  const home = tempHome();
  writeInstance({ home, pid: process.pid, port: 4567 });
  assert.deepEqual(readInstance({ home }), { pid: process.pid, port: 4567, url: 'http://127.0.0.1:4567/' });
  if (process.platform !== 'win32') assert.equal(fs.statSync(file(home)).mode & 0o777, 0o600);
});

test('a dead pid reads as null and removes the file', () => {
  const home = tempHome();
  writeInstance({ home, pid: 999999, port: 4567 });
  assert.equal(readInstance({ home }), null);
  assert.equal(fs.existsSync(file(home)), false);
});

test('missing and malformed files read as null', () => {
  const home = tempHome();
  assert.equal(readInstance({ home }), null);
  fs.mkdirSync(path.dirname(file(home)), { recursive: true });
  fs.writeFileSync(file(home), '{nope');
  assert.equal(readInstance({ home }), null);
});

test('clearInstance removes the file and tolerates absence', () => {
  const home = tempHome();
  writeInstance({ home, pid: process.pid, port: 1 });
  clearInstance({ home });
  assert.equal(fs.existsSync(file(home)), false);
  clearInstance({ home });
});

test('readStudioUrl appends the 12 hex project id and the file has no token', () => {
  const home = tempHome();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-repo-'));
  assert.equal(readStudioUrl(repo, { home }), null);
  writeInstance({ home, pid: process.pid, port: 4567 });
  const url = readStudioUrl(repo, { home });
  assert.equal(url, `http://127.0.0.1:4567/?project=${projectId(repo)}`);
  assert.match(url, /\?project=[0-9a-f]{12}$/);
  assert.equal(fs.readFileSync(file(home), 'utf8').includes('token'), false);
});

test('projectId follows symlinks to the real path', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-repo-'));
  const link = `${repo}-link`;
  fs.symlinkSync(repo, link);
  assert.equal(projectId(link), projectId(repo));
});

test('clearInstanceIfOwned removes only a file written by the given pid', () => {
  const home = tempHome();
  writeInstance({ home, pid: process.ppid, port: 4567 });
  clearInstanceIfOwned({ home, pid: process.pid });
  assert.equal(fs.existsSync(file(home)), true);
  writeInstance({ home, pid: process.pid, port: 4567 });
  clearInstanceIfOwned({ home, pid: process.pid });
  assert.equal(fs.existsSync(file(home)), false);
});

test('readInstance rebuilds the loopback url from the port and ignores a stored url', () => {
  const home = tempHome();
  fs.mkdirSync(path.dirname(file(home)), { recursive: true });
  fs.writeFileSync(file(home), JSON.stringify({ schemaVersion: 1, pid: process.pid, port: 4567, url: 'http://evil.test/?token=x' }));
  assert.deepEqual(readInstance({ home }), { pid: process.pid, port: 4567, url: 'http://127.0.0.1:4567/' });
  fs.writeFileSync(file(home), JSON.stringify({ schemaVersion: 1, pid: process.pid, port: 70000 }));
  assert.equal(readInstance({ home }), null);
});
