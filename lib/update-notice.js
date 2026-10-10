'use strict';

// Update notice (decision 1 on #37). Project installs are notify-only, so the
// notice has to be worth reading: current -> target, 2-4 changelog highlights
// for the versions in between, one copy-pasteable command for the detected
// package manager, and how to silence it. Shown on an interactive stderr only,
// at most once per 24 hours per project, never in CI or --json output.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { compareVersions } = require('./update-manager.js');

const NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_HIGHLIGHTS = 4;
const truthy = (value) => ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());

function detectPackageManager(projectDir) {
  const has = (file) => fs.existsSync(path.join(projectDir, file));
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    const declared = String(pkg.packageManager || '').split('@')[0];
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(declared)) return declared;
  } catch {
    // No package.json: fall through to lockfiles.
  }
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}

// Global installs: infer the manager from where this package lives.
function detectGlobalPackageManager(packageRoot) {
  const p = String(packageRoot).replace(/\\/g, '/').toLowerCase();
  if (p.includes('/pnpm/')) return 'pnpm';
  if (p.includes('/.bun/')) return 'bun';
  if (p.includes('/yarn/')) return 'yarn';
  return 'npm';
}

function updateCommand({ packageName, target, scope, manager }) {
  const spec = `${packageName}@${target}`;
  if (scope === 'global') {
    return {
      npm: `npm install -g ${spec}`,
      pnpm: `pnpm add -g ${spec}`,
      yarn: `yarn global add ${spec}`,
      bun: `bun add -g ${spec}`
    }[manager] || `npm install -g ${spec}`;
  }
  return {
    npm: `npm install -D ${spec}`,
    pnpm: `pnpm add -D ${spec}`,
    yarn: `yarn add -D ${spec}`,
    bun: `bun add -d ${spec}`
  }[manager] || `npm install -D ${spec}`;
}

function clean(line) {
  return line
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^#+\s+/, '')
    .replace(/\*\*([^*]+?):?\*\*:?\s*/g, '$1: ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max = 96) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// Highlights from CHANGELOG sections `## <version>` with current < version <= target.
// Prefers `###` subsection titles (they summarize a change); falls back to bullets.
function changelogHighlights(changelog, { current, target, max = MAX_HIGHLIGHTS } = {}) {
  const lines = String(changelog || '').replace(/\r\n?/g, '\n').split('\n');
  const titles = [];
  const bullets = [];
  let inRange = false;
  for (const line of lines) {
    const version = line.match(/^##\s+\[?v?(\d+\.\d+\.\d+(?:-[\w.]+)?)\]?/);
    if (version) {
      try {
        inRange = compareVersions(version[1], current) > 0 && compareVersions(version[1], target) <= 0;
      } catch {
        inRange = false;
      }
      continue;
    }
    if (/^##\s/.test(line)) {
      inRange = false;
      continue;
    }
    if (!inRange) continue;
    if (/^###\s/.test(line)) titles.push(truncate(clean(line)));
    else if (/^\s*[-*]\s+\S/.test(line)) bullets.push(truncate(clean(line)));
  }
  const picked = titles.length >= 2 ? titles : [...titles, ...bullets];
  return picked.filter(Boolean).slice(0, max);
}

function formatNotice({ packageName, current, target, bump, scope, manager, highlights = [], policy, reason }) {
  const lines = [`ai-engineering-loop ${current} -> ${target} available (${bump}).`];
  for (const item of highlights.slice(0, MAX_HIGHLIGHTS)) lines.push(`  • ${item}`);
  if (bump === 'major') lines.push('  Major release: read the migration notes in CHANGELOG.md before updating.');
  const cmd = updateCommand({ packageName, target, scope, manager });
  lines.push(`  Update:  ${scope === 'global' && bump !== 'major' && policy === 'notify' ? `${cmd}   (or auto-apply: ai-engineering-loop update policy minor)` : cmd}`);
  if (scope === 'global') lines.push('  Then:    ai-engineering-loop sync-hosts');
  lines.push('  Silence: AEL_NO_UPDATE_NOTICE=1, or ai-engineering-loop update policy off');
  if (reason === 'PINNED') lines.push('  (outside your pin; change it with update policy --pin)');
  return lines.join('\n');
}

// Where and how often the notice may appear.
function noticeAllowed({ env = process.env, argv = process.argv, stderrIsTTY = process.stderr.isTTY } = {}) {
  if (truthy(env.AEL_NO_UPDATE_NOTICE) || truthy(env.CI)) return false;
  if (argv.includes('--json')) return false;
  return Boolean(stderrIsTTY) || truthy(env.AEL_FORCE_UPDATE_NOTICE);
}

function noticeDue(cache, projectKey, now = new Date()) {
  const last = cache && cache.notices && cache.notices[projectKey];
  if (!last || !last.at) return true;
  const age = now.getTime() - Date.parse(last.at);
  return !(age >= 0 && age < NOTICE_INTERVAL_MS);
}

function markNoticeShown(cache, projectKey, target, now = new Date()) {
  const notices = { ...(cache.notices || {}) };
  notices[projectKey] = { version: target, at: now.toISOString() };
  // Keep the map small.
  const keys = Object.keys(notices);
  if (keys.length > 200) for (const key of keys.slice(0, keys.length - 200)) delete notices[key];
  return { ...cache, notices };
}

// Background only: the target's CHANGELOG.md from the npm CDN (package files)
// or the GitHub tag. Resolves null on any failure; 3 s budget per request.
function fetchText(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { 'user-agent': 'ai-engineering-loop' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 512 * 1024) req.destroy();
      });
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

async function fetchChangelog({ packageName, target, repositorySlug, env = process.env, timeoutMs = 3000 }) {
  if (env.AEL_UPDATE_CHANGELOG_FILE) {
    try {
      return fs.readFileSync(env.AEL_UPDATE_CHANGELOG_FILE, 'utf8');
    } catch {
      return null;
    }
  }
  if (truthy(env.AEL_UPDATE_OFFLINE)) return null;
  const urls = [`https://cdn.jsdelivr.net/npm/${packageName}@${target}/CHANGELOG.md`];
  if (repositorySlug) urls.push(`https://raw.githubusercontent.com/${repositorySlug}/v${target}/CHANGELOG.md`);
  for (const url of urls) {
    const text = await fetchText(url, timeoutMs);
    if (text) return text;
  }
  return null;
}

module.exports = {
  NOTICE_INTERVAL_MS,
  MAX_HIGHLIGHTS,
  detectPackageManager,
  detectGlobalPackageManager,
  updateCommand,
  changelogHighlights,
  formatNotice,
  noticeAllowed,
  noticeDue,
  markNoticeShown,
  fetchChangelog
};
