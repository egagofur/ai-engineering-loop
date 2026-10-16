'use strict';

// One adapter detector for `init`, `generate-adapter` and Studio (#62).
// Priority: origin remote host -> CI files -> standard.

const fs = require('fs');
const path = require('path');

const DOT_GITLAB_HOST = 'gitlab.dot.co.id';

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// Returns the git config text for rootDir. Follows a `.git` file
// (`gitdir: ...`) and its `commondir`, so linked worktrees work.
function readGitConfig(rootDir) {
  const dotGit = path.join(rootDir, '.git');
  let stat;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return '';
  }
  if (stat.isDirectory()) return readFileSafe(path.join(dotGit, 'config'));
  const match = readFileSafe(dotGit).match(/^gitdir:\s*(.+)$/m);
  if (!match) return '';
  const gitDir = path.resolve(rootDir, match[1].trim());
  const common = readFileSafe(path.join(gitDir, 'commondir')).trim();
  const configDir = common ? path.resolve(gitDir, common) : gitDir;
  return readFileSafe(path.join(configDir, 'config'));
}

// Remote URLs in config order: [{ name, url }].
function parseRemotes(configText) {
  const remotes = [];
  let current = null;
  for (const raw of String(configText || '').split(/\r?\n/)) {
    const line = raw.trim();
    const section = line.match(/^\[\s*([^\s\]"]+)(?:\s+"([^"]*)")?\s*\]$/);
    if (section) {
      current = section[1].toLowerCase() === 'remote' ? section[2] : null;
      continue;
    }
    if (current === null || current === undefined) continue;
    const kv = line.match(/^url\s*=\s*(.+)$/i);
    if (kv && !remotes.some((remote) => remote.name === current)) {
      remotes.push({ name: current, url: kv[1].trim() });
    }
  }
  return remotes;
}

// `origin` first, otherwise the first remote.
function readGitRemote(rootDir) {
  const remotes = parseRemotes(readGitConfig(rootDir));
  const origin = remotes.find((remote) => remote.name === 'origin');
  const chosen = origin || remotes[0];
  return chosen ? { name: chosen.name, url: chosen.url } : { name: '', url: '' };
}

function remoteHost(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  const withScheme = value.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i);
  if (withScheme) return withScheme[1].toLowerCase();
  const scp = value.match(/^(?:[^@/]+@)?([^/:]+):/);
  return scp ? scp[1].toLowerCase() : '';
}

// Adapter type for a remote URL, or null when the host says nothing.
function typeFromRemote(url) {
  const host = remoteHost(url);
  if (!host) return null;
  if (host === DOT_GITLAB_HOST) return 'dot';
  if (host === 'github.com') return 'github';
  if (host.includes('gitlab')) return 'gitlab';
  return null;
}

function detectCi(rootDir) {
  if (fs.existsSync(path.join(rootDir, '.github', 'workflows'))) return 'GitHub Actions';
  if (fs.existsSync(path.join(rootDir, '.gitlab-ci.yml'))) return 'GitLab CI';
  return 'none';
}

const CI_TYPES = { 'GitHub Actions': 'github', 'GitLab CI': 'gitlab' };

function detectAdapter(rootDir) {
  const remote = readGitRemote(rootDir);
  const ciProvider = detectCi(rootDir);
  const fromRemote = typeFromRemote(remote.url);
  if (fromRemote) {
    return {
      type: fromRemote,
      reason: `remote ${remote.name} host ${remoteHost(remote.url)}`,
      remote: remote.url,
      ciProvider
    };
  }
  if (CI_TYPES[ciProvider]) {
    return { type: CI_TYPES[ciProvider], reason: `CI: ${ciProvider}`, remote: remote.url, ciProvider };
  }
  return {
    type: 'standard',
    reason: remote.url ? `remote host ${remoteHost(remote.url) || '(unknown)'} not recognized; no CI files` : 'no remote; no CI files',
    remote: remote.url,
    ciProvider
  };
}

module.exports = {
  DOT_GITLAB_HOST,
  detectAdapter,
  detectCi,
  parseRemotes,
  readGitConfig,
  readGitRemote,
  remoteHost,
  typeFromRemote
};
