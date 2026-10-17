'use strict';

// `setup` and `hosts list|enable|disable` (#49). Pure helpers: they compute and
// persist the host selection in ~/.ai-engineering-loop/config.json; the CLI
// then runs the normal sync (manifest-based copy and cleanup).

const path = require('path');
const { HOSTS, HOST_IDS, OUT_OF_SCOPE, SHARED_SKILLS_DIR, getHost, guardrailSupport, usesSharedSkills } = require('./registry.js');
const { detectHosts } = require('./detect.js');
const { readUserConfig, writeUserConfig } = require('../user-state.js');

function parseHostIds(raw) {
  const values = (Array.isArray(raw) ? raw : String(raw || '').split(','))
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const unknown = values.filter((id) => !HOST_IDS.includes(id));
  if (unknown.length) {
    const err = new Error(`Unknown host(s): ${unknown.join(', ')}. Known: ${HOST_IDS.join(', ')}`);
    err.code = 'UNKNOWN_HOST';
    throw err;
  }
  return [...new Set(values)];
}

function skillLocation(host) {
  return usesSharedSkills(host) ? `~/${SHARED_SKILLS_DIR} (shared)` : `~/${host.skills.dir}`;
}

function listHosts({ home, env = process.env, selection }) {
  const detected = new Map(detectHosts({ home, env }).map((d) => [d.id, d]));
  return HOSTS.map((host) => {
    const d = detected.get(host.id);
    return {
      id: host.id,
      name: host.name,
      certification: host.certification,
      guardrails: guardrailSupport(host),
      detected: d.detected,
      via: [...d.dirs.map((dir) => `~/${dir}`), ...d.bins.map((bin) => `PATH:${path.basename(bin)}`)],
      enabled: selection.enabled.has(host.id),
      disabled: selection.disabled.has(host.id),
      skills: skillLocation(host),
      agents: host.agents ? `~/${host.agents.dir}` : null
    };
  });
}

function formatHostsList(rows, selection) {
  const lines = [`Hosts (${selection.source === 'config' ? `saved selection, mode ${selection.mode}` : 'no setup yet: hosts with a config folder are synced'})`];
  lines.push(`  ${'id'.padEnd(16)} ${'enabled'.padEnd(8)} ${'certification'.padEnd(17)} ${'guardrails'.padEnd(10)} ${'detected'.padEnd(28)} skills`);
  for (const row of rows) {
    const state = row.enabled ? 'yes' : row.disabled ? 'off' : '-';
    lines.push(`  ${row.id.padEnd(16)} ${state.padEnd(8)} ${row.certification.padEnd(17)} ${row.guardrails.padEnd(10)} ${(row.detected ? row.via.join(',') : '-').slice(0, 28).padEnd(28)} ${row.skills}`);
  }
  lines.push(`Out of scope (no native skills): ${OUT_OF_SCOPE.map((h) => h.name).join(', ')}.`);
  return lines.join('\n');
}

function savedHosts(home) {
  const config = readUserConfig(home);
  return config.hosts && typeof config.hosts === 'object' && Array.isArray(config.hosts.enabled) ? config.hosts : null;
}

function writeHosts(home, { enabled, disabled, mode, extra = {} }) {
  const next = {
    ...(savedHosts(home) || {}),
    ...extra,
    enabled: HOST_IDS.filter((id) => enabled.has(id)),
    disabled: HOST_IDS.filter((id) => disabled.has(id) && !enabled.has(id)),
    mode: mode === 'auto' ? 'auto' : 'manual',
    updatedAt: new Date().toISOString()
  };
  writeUserConfig({ hosts: next }, home);
  return { enabled: new Set(next.enabled), disabled: new Set(next.disabled), source: 'config', mode: next.mode };
}

// Starting point for enable/disable before any setup: whatever is synced today.
function changeHosts({ home, selection, enable = [], disable = [] }) {
  const enabled = new Set(selection.enabled);
  const disabled = new Set(selection.disabled);
  for (const id of enable) {
    enabled.add(id);
    disabled.delete(id);
  }
  for (const id of disable) {
    enabled.delete(id);
    disabled.add(id);
  }
  return writeHosts(home, { enabled, disabled, mode: selection.mode || 'manual' });
}

// Detection mode for agents installed later (decision 4 on #54): the
// interactive prompt suggests `auto` (Enter = auto); every non-interactive path
// (--yes, CI, scripts) stays `manual` unless --mode says otherwise.
const SETUP_MODE_DEFAULTS = Object.freeze({ interactive: 'auto', nonInteractive: 'manual' });
const SETUP_MODE_QUESTION = 'Sync agents you install later automatically? [Y/n] (recommended: Y = auto) ';

function setupMode({ modeArg = null, interactive = false, answer = '' } = {}) {
  if (modeArg) return modeArg;
  if (!interactive) return SETUP_MODE_DEFAULTS.nonInteractive;
  const value = String(answer || '').trim().toLowerCase();
  if (!value) return SETUP_MODE_DEFAULTS.interactive;
  return ['y', 'yes', 'auto'].includes(value) ? 'auto' : 'manual';
}

function applySetup({ home, ids, mode }) {
  return writeHosts(home, {
    enabled: new Set(ids),
    disabled: new Set(),
    mode,
    extra: { setupAt: new Date().toISOString() }
  });
}

module.exports = {
  parseHostIds,
  listHosts,
  formatHostsList,
  savedHosts,
  changeHosts,
  applySetup,
  setupMode,
  SETUP_MODE_DEFAULTS,
  SETUP_MODE_QUESTION,
  getHost
};
