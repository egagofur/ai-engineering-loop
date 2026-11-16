'use strict';

// Tech-debt ledger (C-14, OpenAI pack tech-debt-tracker, L12 "clean up later
// means never"). Trade-offs the Judge accepted and L3 waivers outlive the Run
// in .ai-engineering-loop/debt.json and come back when a later change
// touches the same file.

const fs = require('fs');
const path = require('path');
const { atomicWriteJson, runsDir } = require('./run-state.js');
const { parseClaimedVsReality, parseLayerCell } = require('./claimed-vs-reality.js');

const DEBT_FILE = path.join('.ai-engineering-loop', 'debt.json');

function debtPath(rootDir) {
  return path.join(rootDir, DEBT_FILE);
}

function loadDebt(rootDir) {
  try {
    const value = JSON.parse(fs.readFileSync(debtPath(rootDir), 'utf8'));
    return Array.isArray(value.items) ? value : { schemaVersion: 1, items: [] };
  } catch {
    return { schemaVersion: 1, items: [] };
  }
}

const fileOf = (location) => String(location || '').replace(/:\d+(?::\d+)?$/, '');

// Debt items for one delivered Run: VALID MEDIUM/LOW findings the Judge
// accepted as trade-offs, and claimed-vs-reality rows with an L3 waiver.
function collectRunDebt(rootDir, runId, { now = new Date() } = {}) {
  const items = [];
  const dir = path.join(runsDir(rootDir), runId);
  let ledger = null;
  try {
    ledger = JSON.parse(fs.readFileSync(path.join(dir, 'findings.json'), 'utf8'));
  } catch {
    ledger = null;
  }
  for (const finding of ledger?.findings || []) {
    if (finding.validity !== 'VALID' || !['MEDIUM', 'LOW'].includes(finding.severity)) continue;
    items.push({
      id: `${runId}:${finding.id}`,
      runId,
      kind: 'accepted-finding',
      file: fileOf(finding.location),
      location: finding.location,
      debt: finding.failureScenario,
      whyDeferred: `Judge accepted ${finding.severity} ${finding.axis || 'spec'} finding as a trade-off`,
      risk: finding.severity,
      nextTrigger: `next change touching ${fileOf(finding.location)}`,
      status: 'open',
      createdAt: now.toISOString()
    });
  }
  let markdown = '';
  try {
    markdown = fs.readFileSync(path.join(rootDir, '.ai-engineering-loop', 'tasks', 'claimed-vs-reality.md'), 'utf8');
  } catch {
    markdown = '';
  }
  for (const row of parseClaimedVsReality(markdown).rows) {
    const waiver = parseLayerCell(row.layer).waiver;
    if (!waiver) continue;
    const ac = (String(row.ac).match(/\bAC-\d+\b/) || [row.ac.slice(0, 20)])[0];
    items.push({
      id: `${runId}:${ac}:L3`,
      runId,
      kind: 'l3-waiver',
      file: null,
      location: ac,
      debt: `${ac} shipped without end-to-end (L3) evidence`,
      whyDeferred: waiver,
      risk: 'MEDIUM',
      nextTrigger: 'when an e2e command is added to verification.md',
      status: 'open',
      createdAt: now.toISOString()
    });
  }
  return items;
}

function recordRunDebt(rootDir, runId, options) {
  const ledger = loadDebt(rootDir);
  const known = new Set(ledger.items.map((item) => item.id));
  const added = collectRunDebt(rootDir, runId, options).filter((item) => !known.has(item.id));
  if (!added.length) return { added: 0, path: DEBT_FILE.split(path.sep).join('/') };
  atomicWriteJson(debtPath(rootDir), { schemaVersion: 1, items: [...ledger.items, ...added] });
  return { added: added.length, path: DEBT_FILE.split(path.sep).join('/') };
}

// Open debt on any of `files` (plus file-less waivers when `includeGlobal`).
function openDebtFor(rootDir, files = [], { includeGlobal = false } = {}) {
  const wanted = new Set(files);
  return loadDebt(rootDir).items.filter((item) => item.status === 'open'
    && ((item.file && wanted.has(item.file)) || (includeGlobal && !item.file)));
}

function closeDebt(rootDir, id, { by, note } = {}) {
  if (!String(by || '').trim()) throw Object.assign(new Error('debt close needs --by <name>'), { code: 'INVALID_USAGE' });
  const ledger = loadDebt(rootDir);
  const item = ledger.items.find((entry) => entry.id === id);
  if (!item) throw Object.assign(new Error(`No debt item ${id}`), { code: 'NOT_FOUND' });
  Object.assign(item, { status: 'closed', closedBy: by, closedAt: new Date().toISOString(), ...(note ? { note } : {}) });
  atomicWriteJson(debtPath(rootDir), ledger);
  return item;
}

module.exports = { DEBT_FILE, closeDebt, collectRunDebt, loadDebt, openDebtFor, recordRunDebt };
