'use strict';

// Host detection (#49): a config directory under $HOME, or an executable on
// PATH. PATH entries are only stat()ed; nothing is ever executed, so detection
// is safe to run from `status`, `--json`, and CI.

const fs = require('fs');
const path = require('path');
const { HOSTS } = require('./registry.js');

function isExecutableFile(file, platform) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    return platform === 'win32' ? true : (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function findOnPath(name, env = process.env, platform = process.platform) {
  const raw = env.PATH || env.Path || '';
  const dirs = raw.split(path.delimiter).filter(Boolean);
  const exts = platform === 'win32'
    ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return null;
}

function detectHost(host, { home, env = process.env, platform = process.platform } = {}) {
  const dirs = host.detect.dirs.filter((rel) => {
    try {
      return fs.statSync(path.join(home, rel)).isDirectory();
    } catch {
      return false;
    }
  });
  const bins = [];
  for (const name of host.detect.bins || []) {
    const found = findOnPath(name, env, platform);
    if (found) bins.push(found);
  }
  return { id: host.id, detected: dirs.length > 0 || bins.length > 0, dirs, bins };
}

function detectHosts(options = {}) {
  return (options.hosts || HOSTS).map((host) => detectHost(host, options));
}

module.exports = { findOnPath, detectHost, detectHosts };
