'use strict';

// User-level (per machine) AEL state lives in <home>/.ai-engineering-loop/.
// It is never part of a repository. `home` resolves AEL_HOME first so tests and
// sandboxes never touch the real home directory.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sha256, writePrivateFile } = require('./fsutil.js');

function homeDir(env = process.env) {
  if (env.AEL_HOME) return env.AEL_HOME;
  return os.homedir();
}

function userStateDir(home = homeDir()) {
  return path.join(home, '.ai-engineering-loop');
}

function userStatePath(name, home = homeDir()) {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(name)) throw new Error(`Invalid user-state file name: ${name}`);
  return path.join(userStateDir(home), name);
}

function atomicWritePrivate(filePath, content) {
  writePrivateFile(filePath, content, { dirMode: 0o700 });
}

function readJsonFile(filePath, fallback) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  atomicWritePrivate(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readUserConfig(home = homeDir()) {
  const value = readJsonFile(userStatePath('config.json', home), {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function writeUserConfig(patch, home = homeDir()) {
  const next = { ...readUserConfig(home), ...patch };
  writeJsonFile(userStatePath('config.json', home), next);
  return next;
}

function workflowDir(home = homeDir()) {
  return path.join(userStateDir(home), 'workflow');
}

function personalRecipePath(home = homeDir()) {
  return path.join(workflowDir(home), 'personal.json');
}

function personalHistoryDir(home = homeDir()) {
  return path.join(workflowDir(home), '.history');
}

function workflowHistoryPath(home = homeDir()) {
  return path.join(userStateDir(home), 'workflow-history.jsonl');
}

function proposalsDir(home = homeDir()) {
  return path.join(userStateDir(home), 'workflow-proposals');
}

function proposalPath(id, home = homeDir()) {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(String(id || ''))) {
    throw new Error(`Invalid proposal id: ${id || '(empty)'}`);
  }
  return path.join(proposalsDir(home), `${id}.json`);
}

module.exports = {
  homeDir,
  userStateDir,
  userStatePath,
  sha256,
  atomicWritePrivate,
  readJsonFile,
  writeJsonFile,
  readUserConfig,
  writeUserConfig,
  workflowDir,
  personalRecipePath,
  personalHistoryDir,
  workflowHistoryPath,
  proposalsDir,
  proposalPath
};
