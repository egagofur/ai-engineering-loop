'use strict';

// Project registry (issue #37): ~/.ai-engineering-loop/projects.json lists local
// repositories that contain `.ai-engineering-loop/`, so a CLI update can refresh
// every project. It only holds local paths and is never sent anywhere.

const fs = require('fs');
const path = require('path');
const { homeDir, userStatePath, readJsonFile, writeJsonFile } = require('./user-state.js');

const REGISTRY_FILE = 'projects.json';
const CONTEXT_DIR = '.ai-engineering-loop';
const SCAN_EXCLUDES = new Set(['node_modules', '.git', '.hg', '.svn', 'vendor', 'dist', 'build', '.next', '.cache', 'Library', 'AppData']);

// Automatic writes to the user's home are disabled by AEL_NO_REGISTRY and,
// as a safety net, inside the Node test runner unless a sandbox AEL_HOME is set.
function registryEnabled(env = process.env) {
  if (env.AEL_NO_REGISTRY === '1') return false;
  if (env.NODE_TEST_CONTEXT && !env.AEL_HOME) return false;
  return true;
}

function registryPath(home = homeDir()) {
  return userStatePath(REGISTRY_FILE, home);
}

function hasContext(dir) {
  try {
    return fs.statSync(path.join(dir, CONTEXT_DIR)).isDirectory();
  } catch {
    return false;
  }
}

function readContextVersion(dir) {
  const metadata = readJsonFile(path.join(dir, CONTEXT_DIR, 'metadata.json'), null);
  return metadata && metadata.contextVersion ? String(metadata.contextVersion) : null;
}

function readRegistry(home = homeDir()) {
  const value = readJsonFile(registryPath(home), null);
  const projects = value && Array.isArray(value.projects) ? value.projects.filter((p) => p && typeof p.path === 'string') : [];
  return { schemaVersion: 1, projects };
}

function writeRegistry(registry, home = homeDir()) {
  const projects = [...registry.projects].sort((a, b) => a.path.localeCompare(b.path));
  writeJsonFile(registryPath(home), { schemaVersion: 1, projects });
}

function canonical(dir) {
  const abs = path.resolve(dir);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

function upsert(registry, dir, now) {
  const abs = canonical(dir);
  const entry = { path: abs, contextVersion: readContextVersion(abs), lastSeen: now.toISOString() };
  const index = registry.projects.findIndex((p) => p.path === abs);
  if (index === -1) registry.projects.push(entry);
  else registry.projects[index] = { ...registry.projects[index], ...entry };
  return entry;
}

// Called by init/run/status/refresh. Never throws: the registry is a convenience.
function registerProject(dir, { home = homeDir(), env = process.env, now = new Date() } = {}) {
  if (!registryEnabled(env) || !hasContext(dir)) return null;
  try {
    const registry = readRegistry(home);
    const entry = upsert(registry, dir, now);
    writeRegistry(registry, home);
    return entry;
  } catch {
    return null;
  }
}

function addProject(dir, { home = homeDir(), now = new Date() } = {}) {
  if (!hasContext(dir)) {
    const err = new Error(`${path.resolve(dir)} has no ${CONTEXT_DIR}/ (run init there first)`);
    err.code = 'NO_CONTEXT';
    throw err;
  }
  const registry = readRegistry(home);
  const entry = upsert(registry, dir, now);
  writeRegistry(registry, home);
  return entry;
}

function removeProject(dir, { home = homeDir() } = {}) {
  const abs = canonical(dir);
  const registry = readRegistry(home);
  const before = registry.projects.length;
  registry.projects = registry.projects.filter((p) => p.path !== abs && p.path !== path.resolve(dir));
  writeRegistry(registry, home);
  return before !== registry.projects.length;
}

// Lists projects and drops entries whose folder or context directory is gone.
function listProjects({ home = homeDir(), prune = true } = {}) {
  const registry = readRegistry(home);
  const kept = registry.projects.filter((p) => hasContext(p.path));
  const removed = registry.projects.filter((p) => !kept.includes(p));
  if (prune && removed.length) writeRegistry({ projects: kept }, home);
  return { projects: kept.map((p) => ({ ...p, contextVersion: readContextVersion(p.path) || p.contextVersion || null })), removed: removed.map((p) => p.path) };
}

// Manual, bounded scan. Does not follow symlinks or descend into excluded dirs.
function scanProjects(root, { home = homeDir(), maxDepth = 4, now = new Date() } = {}) {
  const found = [];
  const walk = (dir, depth) => {
    if (hasContext(dir)) found.push(dir);
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (SCAN_EXCLUDES.has(entry.name) || entry.name === CONTEXT_DIR) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(path.resolve(root), 0);
  const registry = readRegistry(home);
  const entries = found.map((dir) => upsert(registry, dir, now));
  writeRegistry(registry, home);
  return { root: path.resolve(root), maxDepth, found: entries };
}

module.exports = {
  REGISTRY_FILE,
  SCAN_EXCLUDES,
  registryEnabled,
  registryPath,
  readRegistry,
  registerProject,
  addProject,
  removeProject,
  listProjects,
  scanProjects
};
