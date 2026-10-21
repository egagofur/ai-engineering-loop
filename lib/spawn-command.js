'use strict';

// Cross-platform helpers for spawning commands without a shell.
// - Windows cannot spawn npm, npx, or other .cmd/.bat shims directly, and
//   Node >= 18.20 refuses to try (EINVAL). resolveSpawn() finds the command on
//   PATH via PATHEXT and runs batch shims through cmd.exe with escaped args.
// - killProcessTree() stops a command and everything it started, so an
//   orphaned grandchild cannot keep the output pipes open.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function envValue(env, name) {
  const key = Object.keys(env).find((item) => item.toUpperCase() === name);
  return key ? env[key] : undefined;
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findOnPath(command, env) {
  const extensions = String(envValue(env, 'PATHEXT') || DEFAULT_PATHEXT)
    .split(';').map((item) => item.trim()).filter(Boolean);
  const hasExtension = extensions.some((ext) => command.toLowerCase().endsWith(ext.toLowerCase()));
  const candidates = hasExtension ? [command] : extensions.map((ext) => `${command}${ext.toLowerCase()}`);
  const directories = /[\\/]/.test(command)
    ? ['']
    : String(envValue(env, 'PATH') || '').split(';').map((item) => item.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const directory of directories) {
    for (const candidate of candidates) {
      const full = directory ? path.join(directory, candidate) : candidate;
      if (isFile(full)) return full;
    }
  }
  return null;
}

function escapeArgument(argument, doubleEscape) {
  let value = String(argument)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1');
  value = `"${value}"`.replace(CMD_META, '^$1');
  return doubleEscape ? value.replace(CMD_META, '^$1') : value;
}

function resolveSpawn(command, args = [], { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { command, args, options: {} };
  const resolved = findOnPath(command, env);
  if (!resolved) return { command, args, options: {} };
  if (!/\.(?:cmd|bat)$/i.test(resolved)) return { command: resolved, args, options: {} };
  // node_modules/.bin shims re-expand %* through cmd once more.
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(resolved);
  const line = [resolved.replace(CMD_META, '^$1'), ...args.map((arg) => escapeArgument(arg, doubleEscape))].join(' ');
  return {
    command: envValue(env, 'COMSPEC') || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true }
  };
}

// POSIX: the child must have been spawned with `detached: true` so it leads
// its own process group. Windows: taskkill /T walks the tree.
function killProcessTree(child, signal = 'SIGTERM', { platform = process.platform } = {}) {
  if (!child?.pid) return;
  if (platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        .on('error', () => { try { child.kill(signal); } catch {} });
    } catch {
      try { child.kill(signal); } catch {}
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch {}
  }
}

module.exports = {
  escapeArgument,
  killProcessTree,
  resolveSpawn
};
