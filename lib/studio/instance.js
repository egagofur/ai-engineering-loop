'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { writePrivateJson, readJsonOptional } = require('../fsutil.js');
const { userStatePath } = require('../user-state.js');

const INSTANCE_FILE = 'studio.json';

function projectId(projectPath) {
  return crypto.createHash('sha256').update(fs.realpathSync(projectPath)).digest('hex').slice(0, 12);
}

function instanceFile(home) {
  return userStatePath(INSTANCE_FILE, home);
}

function writeInstance({ home, pid, port }) {
  writePrivateJson(instanceFile(home), {
    schemaVersion: 1,
    pid,
    port,
    url: `http://127.0.0.1:${port}/`,
    startedAt: new Date().toISOString()
  }, { dirMode: 0o700 });
}

function clearInstance({ home } = {}) {
  try {
    fs.unlinkSync(instanceFile(home));
  } catch {
    return;
  }
}

function clearInstanceIfOwned({ home, pid } = {}) {
  const stored = readJsonOptional(instanceFile(home), null);
  if (stored && stored.pid === pid) clearInstance({ home });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readInstance({ home } = {}) {
  const stored = readJsonOptional(instanceFile(home), null);
  if (!stored || typeof stored.url !== 'string' || !Number.isInteger(stored.port)) {
    return null;
  }
  if (!pidAlive(stored.pid)) {
    clearInstance({ home });
    return null;
  }
  return { pid: stored.pid, port: stored.port, url: stored.url };
}

function readStudioUrl(rootDir, { home } = {}) {
  const instance = readInstance({ home });
  if (!instance) return null;
  try {
    return `${instance.url}?project=${projectId(rootDir)}`;
  } catch {
    return null;
  }
}

module.exports = { projectId, writeInstance, readInstance, clearInstance, clearInstanceIfOwned, readStudioUrl };
