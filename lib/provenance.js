'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadGathered } = require('./sources.js');

const KINDS = ['fact', 'decision', 'assumption'];

function validateStatements(statements) {
  if (statements === undefined) return [];
  if (!Array.isArray(statements)) return ['statements must be an array of { text, kind, source?, by? }'];
  const errors = [];
  statements.forEach((item, index) => {
    if (!item || typeof item !== 'object' || !String(item.text || '').trim()) errors.push(`statements[${index}].text is required`);
    else if (!KINDS.includes(item.kind)) errors.push(`statements[${index}].kind must be ${KINDS.join(', ')}`);
  });
  return errors;
}

function checkFileLine(rootDir, ref) {
  const match = String(ref).match(/^(.+?):(\d+)(?:-\d+)?$/);
  if (!match) return null;
  const file = path.resolve(rootDir, match[1]);
  const relative = path.relative(rootDir, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return 'path is outside the repository';
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n').length;
  } catch {
    return `${match[1]} does not exist`;
  }
  return Number(match[2]) >= 1 && Number(match[2]) <= lines ? true : `${match[1]} has ${lines} line(s), not ${match[2]}`;
}

function checkCommit(rootDir, ref) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(ref))) return null;
  const result = spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: rootDir, stdio: 'ignore' });
  return result.status === 0 ? true : `commit ${ref} does not exist`;
}

function checkGathered(gathered, ref) {
  if (/^S-\d+$/.test(String(ref))) return gathered.some((entry) => entry.id === ref) ? true : `${ref} is not in sources.json`;
  if (/^https?:\/\//i.test(String(ref))) return gathered.some((entry) => entry.ref === ref) ? true : 'URL was not recorded with `sources record`';
  return null;
}

function verifySource(rootDir, gathered, ref) {
  if (!String(ref || '').trim()) return 'no source';
  for (const check of [checkGathered(gathered, ref), checkCommit(rootDir, ref), checkFileLine(rootDir, ref)]) {
    if (check !== null) return check;
  }
  return 'source must be path:line, a commit SHA, a recorded URL or S-n';
}

function checkProvenance(rootDir, runId, contract) {
  const gathered = loadGathered(rootDir, runId);
  const statements = (Array.isArray(contract?.statements) ? contract.statements : []).map((item) => {
    const declared = item.kind;
    let kind = declared;
    let reason = null;
    if (declared === 'fact') {
      const result = verifySource(rootDir, gathered, item.source);
      if (result !== true) {
        kind = 'assumption';
        reason = `fact downgraded: ${result}`;
      }
    } else if (declared === 'decision' && !String(item.by || '').trim()) {
      const result = item.source ? verifySource(rootDir, gathered, item.source) : 'no --by and no source';
      if (result !== true) {
        kind = 'assumption';
        reason = `decision downgraded: ${result}`;
      }
    }
    return { text: String(item.text).trim(), declared, kind, ...(item.source ? { source: item.source } : {}), ...(item.by ? { by: item.by } : {}), ...(reason ? { reason } : {}) };
  });
  const assumptions = statements.filter((item) => item.kind === 'assumption');
  return {
    schemaVersion: 1,
    runId,
    counts: Object.fromEntries(KINDS.map((kind) => [kind, statements.filter((item) => item.kind === kind).length])),
    downgraded: statements.filter((item) => item.reason).length,
    statements,
    unconfirmed: assumptions.map((item) => item.reason ? `${item.text} (${item.reason})` : item.text)
  };
}

function provenancePath(rootDir, runId) {
  return path.join(rootDir, '.ai-engineering-loop', 'runs', runId, 'provenance.json');
}

function writeProvenance(rootDir, runId, contract) {
  const result = checkProvenance(rootDir, runId, contract);
  fs.writeFileSync(provenancePath(rootDir, runId), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

function loadProvenance(rootDir, runId) {
  try {
    return JSON.parse(fs.readFileSync(provenancePath(rootDir, runId), 'utf8'));
  } catch {
    return null;
  }
}

function renderUnconfirmed(provenance, heading = '### Unconfirmed assumptions') {
  if (!provenance || !provenance.unconfirmed.length) return [];
  return [heading, '', ...provenance.unconfirmed.map((text) => `- ${text}`), ''];
}

module.exports = { KINDS, checkProvenance, loadProvenance, renderUnconfirmed, validateStatements, writeProvenance };
