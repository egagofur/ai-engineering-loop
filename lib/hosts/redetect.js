'use strict';

// Re-detection of agents installed after `setup` (#52). Detection is stat-only
// (see detect.js), so this is cheap enough for `status` and `update auto`.
// - hosts.mode auto: `update auto` enables new hosts and syncs them.
// - hosts.mode manual: a short notice, once per new host, at most once a day,
//   never in CI, JSON output, or with AEL_NO_AUTO_UPDATE.

const { HOST_IDS } = require('./registry.js');
const { detectHosts } = require('./detect.js');
const { savedHosts } = require('./commands.js');
const { readUserConfig, writeUserConfig, userStatePath, readJsonFile, writeJsonFile } = require('../user-state.js');

const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const truthy = (value) => ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());

// Hosts detected now that the saved selection has never seen (neither enabled
// nor disabled). Null before `setup`: legacy mode already follows config folders.
function findNewHosts({ home, env = process.env }) {
  const saved = savedHosts(home);
  if (!saved) return null;
  const known = new Set([...(saved.enabled || []), ...(Array.isArray(saved.disabled) ? saved.disabled : [])]);
  return detectHosts({ home, env }).filter((d) => d.detected && !known.has(d.id)).map((d) => d.id);
}

function quietHere(env = process.env) {
  return truthy(env.CI) || truthy(env.AEL_NO_AUTO_UPDATE);
}

// Called by `update auto` (already a no-op in CI / AEL_NO_AUTO_UPDATE / policy
// off). Only global installs enable hosts on their own.
function autoEnableNewHosts({ home, env = process.env, scope }) {
  if (quietHere(env)) return { added: [], reason: 'quiet' };
  const saved = savedHosts(home);
  if (!saved || saved.mode !== 'auto') return { added: [], reason: saved ? 'mode-manual' : 'no-setup' };
  if (scope !== 'global') return { added: [], reason: 'not-global' };
  const fresh = findNewHosts({ home, env }) || [];
  if (!fresh.length) return { added: [] };
  const enabled = HOST_IDS.filter((id) => saved.enabled.includes(id) || fresh.includes(id));
  writeUserConfig({ hosts: { ...readUserConfig(home).hosts, enabled, updatedAt: new Date().toISOString() } }, home);
  return { added: fresh };
}

// Manual mode (or auto mode outside a syncing run): a one-line notice.
function newHostsNotice({ home, env = process.env, now = Date.now() }) {
  if (quietHere(env)) return null;
  const saved = savedHosts(home);
  if (!saved || saved.mode === 'auto') return null;
  const fresh = findNewHosts({ home, env }) || [];
  const stampFile = userStatePath('hosts-notice.json', home);
  const state = readJsonFile(stampFile, {});
  const notified = new Set(Array.isArray(state.notified) ? state.notified : []);
  const unseen = fresh.filter((id) => !notified.has(id));
  if (!unseen.length) return null;
  if (state.at && now - Date.parse(state.at) < NOTICE_INTERVAL_MS) return null;
  writeJsonFile(stampFile, { at: new Date(now).toISOString(), notified: [...notified, ...unseen] });
  return `ai-engineering-loop: new agent${unseen.length === 1 ? '' : 's'} detected: ${unseen.join(', ')}. Add with "ai-engineering-loop hosts enable ${unseen.join(' ')}" (or "setup --mode auto"; silence: AEL_NO_AUTO_UPDATE=1).`;
}

module.exports = { NOTICE_INTERVAL_MS, findNewHosts, autoEnableNewHosts, newHostsNotice };
