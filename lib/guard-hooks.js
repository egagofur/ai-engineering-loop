'use strict';

// `hooks install | uninstall | status` (#59): native pre-tool hooks that call
// `guard check`. Claude Code first; hosts without a hook API stay advisory.
// Project-level settings, because the guard reads this repository's Run.

const fs = require('fs');
const path = require('path');
const { HOSTS, getHost, guardrailSupport } = require('./hosts/registry.js');

const HOOK_MARKER = 'ai-engineering-loop guard check';
// Matches pinned (ai-engineering-loop@x.y.z) and older unpinned commands.
const HOOK_PATTERN = /ai-engineering-loop(?:@\S+)? guard check/;
const CLAUDE_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit|Bash';
const { version: PACKAGE_VERSION } = require('../package.json');

// Pinned so a hook never resolves whatever version the registry serves today.
const CLAUDE_COMMAND = `npx --yes ai-engineering-loop@${PACKAGE_VERSION} guard check --hook claude`;

function hooksError(message, code = 'INVALID_USAGE') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hookHost(hostId = 'claude') {
  const host = getHost(hostId);
  if (!host) throw hooksError(`Unknown host: ${hostId}`);
  if (guardrailSupport(host) !== 'enforced') {
    const enforced = HOSTS.filter((item) => guardrailSupport(item) === 'enforced').map((item) => item.id);
    throw hooksError(`${host.name} has no hook API; its guardrails are advisory. Hosts with hooks: ${enforced.join(', ')}`, 'HOOKS_UNSUPPORTED');
  }
  return host;
}

function settingsPath(rootDir, host) {
  return path.join(rootDir, host.hooks.settings);
}

function readSettings(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw hooksError(`${filePath} must be a regular file`, 'UNSAFE_HOOKS_PATH');
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch (cause) {
    throw hooksError(`Cannot update ${path.basename(filePath)}: ${cause.message}. Nothing was written.`, 'INVALID_HOOKS_SETTINGS');
  }
}

function writeSettings(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

function isOurHook(hook) {
  return typeof hook?.command === 'string' && HOOK_PATTERN.test(hook.command);
}

function ourEntries(settings) {
  return (settings.hooks?.PreToolUse || []).filter((entry) => (entry.hooks || []).some(isOurHook));
}

function hooksStatus(rootDir, { host: hostId = 'claude' } = {}) {
  const host = hookHost(hostId);
  const filePath = settingsPath(rootDir, host);
  const settings = readSettings(filePath);
  return {
    host: host.id,
    guardrails: guardrailSupport(host),
    settings: host.hooks.settings,
    installed: ourEntries(settings).length > 0
  };
}

function installHooks(rootDir, { host: hostId = 'claude' } = {}) {
  const host = hookHost(hostId);
  const filePath = settingsPath(rootDir, host);
  const settings = readSettings(filePath);
  const existing = ourEntries(settings);
  if (existing.length) {
    const current = existing.every((entry) => entry.hooks.every((hook) => !isOurHook(hook) || hook.command === CLAUDE_COMMAND));
    if (current) return { ...hooksStatus(rootDir, { host: host.id }), changed: false };
    // Re-pin hooks written by an older install (unpinned or another version).
    writeSettings(filePath, {
      ...settings,
      hooks: {
        ...settings.hooks,
        PreToolUse: settings.hooks.PreToolUse.map((entry) => ({
          ...entry,
          hooks: (entry.hooks || []).map((hook) => (isOurHook(hook) ? { ...hook, command: CLAUDE_COMMAND } : hook))
        }))
      }
    });
    return { ...hooksStatus(rootDir, { host: host.id }), changed: true };
  }
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  writeSettings(filePath, {
    ...settings,
    hooks: {
      ...hooks,
      PreToolUse: [...preToolUse, { matcher: CLAUDE_MATCHER, hooks: [{ type: 'command', command: CLAUDE_COMMAND }] }]
    }
  });
  return { ...hooksStatus(rootDir, { host: host.id }), changed: true };
}

function uninstallHooks(rootDir, { host: hostId = 'claude' } = {}) {
  const host = hookHost(hostId);
  const filePath = settingsPath(rootDir, host);
  if (!fs.existsSync(filePath)) return { ...hooksStatus(rootDir, { host: host.id }), changed: false };
  const settings = readSettings(filePath);
  if (!ourEntries(settings).length) return { ...hooksStatus(rootDir, { host: host.id }), changed: false };
  const preToolUse = settings.hooks.PreToolUse
    .map((entry) => ({ ...entry, hooks: (entry.hooks || []).filter((hook) => !isOurHook(hook)) }))
    .filter((entry) => entry.hooks.length);
  const { PreToolUse: _removed, ...otherHooks } = settings.hooks;
  const hooks = preToolUse.length ? { ...otherHooks, PreToolUse: preToolUse } : otherHooks;
  const { hooks: _old, ...rest } = settings;
  writeSettings(filePath, Object.keys(hooks).length ? { ...rest, hooks } : rest);
  return { ...hooksStatus(rootDir, { host: host.id }), changed: true };
}

module.exports = {
  HOOK_MARKER,
  CLAUDE_COMMAND,
  CLAUDE_MATCHER,
  hooksStatus,
  installHooks,
  uninstallHooks
};
