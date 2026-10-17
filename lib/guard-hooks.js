'use strict';

// `hooks install | uninstall | status` (#59): native pre-tool hooks that call
// `guard check`. Claude Code first; hosts without a hook API stay advisory.
// Project-level settings, because the guard reads this repository's Run.

const fs = require('fs');
const path = require('path');
const { HOSTS, getHost, guardrailSupport } = require('./hosts/registry.js');

const HOOK_MARKER = 'ai-engineering-loop guard check';
const CLAUDE_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit|Bash';
const CLAUDE_COMMAND = 'npx --yes ai-engineering-loop guard check --hook claude';

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
  return typeof hook?.command === 'string' && hook.command.includes(HOOK_MARKER);
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
  if (ourEntries(settings).length) return { ...hooksStatus(rootDir, { host: host.id }), changed: false };
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
