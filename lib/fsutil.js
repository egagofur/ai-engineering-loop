'use strict';

// Small file helpers shared across lib/: one atomic write, one sha256, one
// optional JSON read, one actor-id rule.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Who asked, answered, approved, or acted: a short handle or an email.
const ACTOR_ID = /^[A-Za-z0-9@._-]{1,64}$/;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Missing or unparsable file -> fallback.
function readJsonOptional(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 10;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows reports EPERM/EBUSY while an antivirus scanner, indexer, or a
// concurrent reader briefly holds the destination open. Retry with backoff.
function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (!RENAME_RETRY_CODES.has(error.code) || attempt >= RENAME_ATTEMPTS) throw error;
      sleepSync(Math.min(20 * attempt, 200));
    }
  }
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Write to a temporary sibling, then rename, so readers never see a partial
// file. `mode` (e.g. 0o600) is enforced on the result; without it the file
// gets the process default permissions.
function atomicWrite(filePath, content, { mode, dirMode } = {}) {
  fs.mkdirSync(path.dirname(filePath), dirMode ? { recursive: true, mode: dirMode } : { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, content, mode ? { mode } : undefined);
    renameWithRetry(temporary, filePath);
    if (mode) fs.chmodSync(filePath, mode);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Rename succeeded or no temporary file was written.
    }
  }
}

function writePrivateFile(filePath, content, options = {}) {
  atomicWrite(filePath, content, { ...options, mode: 0o600 });
}

function writePrivateJson(filePath, value, options = {}) {
  writePrivateFile(filePath, jsonText(value), options);
}

module.exports = {
  ACTOR_ID,
  renameWithRetry,
  sleepSync,
  sha256,
  readJsonOptional,
  jsonText,
  atomicWrite,
  writePrivateFile,
  writePrivateJson
};
