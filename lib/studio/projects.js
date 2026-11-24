'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readRegistry } = require('../project-registry.js');
const { loadRegistry } = require('../run-isolation.js');
const { projectId } = require('./instance.js');

const CONTEXT_DIR = '.ai-engineering-loop';

function realOrResolved(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function stableId(target) {
  try {
    return projectId(target);
  } catch {
    return crypto.createHash('sha256').update(path.resolve(target)).digest('hex').slice(0, 12);
  }
}

function displayName(projectPath) {
  return path.resolve(projectPath).split(path.sep).filter(Boolean).slice(-2).join('/');
}

function worktreesOf(projectPath) {
  let registry;
  try {
    registry = loadRegistry(projectPath);
  } catch {
    return [];
  }
  const list = registry && Array.isArray(registry.worktrees) ? registry.worktrees : [];
  return list
    .filter((w) => w && typeof w.path === 'string')
    .map((w) => ({ id: stableId(w.path), path: w.path, branch: w.branch || null, runId: w.runId || null }));
}

function discoverProjects({ home } = {}) {
  const entries = readRegistry(home).projects.map((entry) => {
    const missing = !fs.existsSync(entry.path);
    return {
      id: stableId(entry.path),
      name: displayName(entry.path),
      path: entry.path,
      missing,
      worktrees: missing ? [] : worktreesOf(entry.path)
    };
  });
  const folded = new Set();
  for (const project of entries) {
    for (const worktree of project.worktrees) folded.add(realOrResolved(worktree.path));
  }
  const seen = new Set();
  return entries.filter((project) => {
    if (folded.has(realOrResolved(project.path)) || seen.has(project.id)) return false;
    seen.add(project.id);
    return true;
  });
}

function resolveProject(projects, id) {
  return projects.find((project) => project.id === id) || null;
}

function outsideScope(candidate) {
  const error = new Error(`Path is outside the AEL context directory: ${candidate}`);
  error.code = 'PATH_OUTSIDE_SCOPE';
  error.why = 'Studio only reads files inside <project>/.ai-engineering-loop/.';
  error.fix = 'Request a path under the project context directory.';
  return error;
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function contextPath(root, ...parts) {
  const base = path.resolve(root, CONTEXT_DIR);
  const joined = path.resolve(base, ...parts);
  const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);
  if (!within(joined, base)) throw outsideScope(joined);
  let realBase;
  try {
    realBase = fs.realpathSync(base);
  } catch {
    return joined;
  }
  if (realBase !== path.join(fs.realpathSync(root), CONTEXT_DIR)) throw outsideScope(base);
  let probe = joined;
  while (probe !== base && !lstatOrNull(probe)) probe = path.dirname(probe);
  let realProbe;
  try {
    realProbe = fs.realpathSync(probe);
  } catch {
    throw outsideScope(joined);
  }
  if (!within(realProbe, realBase)) throw outsideScope(joined);
  return joined;
}

function resolveRoot(projects, id) {
  for (const project of projects) {
    if (project.id === id) return { project, root: project.path, worktree: null };
    const worktree = project.worktrees.find((w) => w.id === id);
    if (worktree) return { project, root: worktree.path, worktree };
  }
  return null;
}

module.exports = { discoverProjects, resolveProject, resolveRoot, contextPath };
