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
    fs.renameSync(temporary, filePath);
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
  sha256,
  readJsonOptional,
  jsonText,
  atomicWrite,
  writePrivateFile,
  writePrivateJson
};
