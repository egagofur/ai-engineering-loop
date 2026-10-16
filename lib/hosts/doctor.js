'use strict';

// `hosts doctor` (#52): for every enabled host, how many copies of the core
// skill it can see across the folders it scans, whether they are identical,
// and which AEL files a sync would still write. Read-only.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { HOSTS, usesSharedSkills } = require('./registry.js');
const { certificationLabel } = require('./table.js');

const CORE_SKILL = 'ai-engineering-loop';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function realOrSelf(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

function visibleCopies(host, home, skill = CORE_SKILL) {
  const seen = new Map();
  for (const dir of host.reads) {
    const file = path.join(home, dir, skill, 'SKILL.md');
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch {
      continue;
    }
    const real = realOrSelf(file);
    if (!seen.has(real)) seen.set(real, { path: `~/${dir}/${skill}/SKILL.md`, sha256: sha256(buf) });
  }
  return [...seen.values()];
}

// `plan` is planHostSync(...) output; groups are host ids plus 'shared'.
function hostsDoctor({ home, selection, plan }) {
  const rows = [];
  for (const host of HOSTS) {
    if (!selection.enabled.has(host.id)) continue;
    const copies = visibleCopies(host, home);
    const hashes = new Set(copies.map((c) => c.sha256));
    const groupIds = new Set([host.id, ...(usesSharedSkills(host) ? ['shared'] : [])]);
    const resync = plan
      .filter((item) => groupIds.has(item.id) && item.action === 'copy')
      .map((item) => item.dest.startsWith(home) ? `~${item.dest.slice(home.length)}` : item.dest);
    const problems = [];
    if (!copies.length) problems.push('core skill not installed');
    if (hashes.size > 1) problems.push(`${copies.length} copies with different content`);
    if (resync.length) problems.push(`${resync.length} file(s) need sync`);
    rows.push({ id: host.id, name: host.name, certification: host.certification, certifiedBy: host.certifiedBy || null, copies, identical: hashes.size <= 1, resync, ok: problems.length === 0, problems });
  }
  return { ok: rows.every((row) => row.ok), hosts: rows };
}

function formatHostsDoctor(report) {
  if (!report.hosts.length) return 'hosts doctor: no host is enabled. Run "ai-engineering-loop setup".';
  const lines = ['hosts doctor (core skill copies each host can see):'];
  for (const row of report.hosts) {
    const where = row.copies.map((c) => c.path).join(', ') || '-';
    lines.push(`  ${row.ok ? '✓' : '✗'} ${row.id.padEnd(16)} [${certificationLabel(row)}] ${row.copies.length} cop${row.copies.length === 1 ? 'y' : 'ies'}${row.copies.length > 1 ? (row.identical ? ' (identical)' : ' (DIFFERENT)') : ''}: ${where}`);
    for (const problem of row.problems) lines.push(`      ${problem}`);
    for (const file of row.resync.slice(0, 5)) lines.push(`      needs sync: ${file}`);
    if (row.resync.length > 5) lines.push(`      ... and ${row.resync.length - 5} more`);
  }
  if (!report.ok) lines.push('Fix: "ai-engineering-loop sync-hosts" (edited files are kept; remove an old copy by hand if it differs).');
  return lines.join('\n');
}

module.exports = { CORE_SKILL, visibleCopies, hostsDoctor, formatHostsDoctor };
