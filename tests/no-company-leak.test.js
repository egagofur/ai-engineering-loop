'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SKIP_DIR = new Set([
  '.git',
  'node_modules',
  '.serena',
  '.DS_Store'
]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const abs = path.join(dir, name);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(abs, out);
    else if (st.isFile()) out.push(abs);
  }
  return out;
}

function rel(abs) {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

const FINGERPRINTS = [
  { re: /dotify/i, label: 'dotify' },
  { re: /bikin-rindu/i, label: 'bikin-rindu' },
  { re: /hasNormalHours/, label: 'hasNormalHours' },
  { re: /overtimeNote/, label: 'overtimeNote' },
  { re: /attendanceConfirmation/i, label: 'attendanceConfirmation' },
  { re: /internal-dotify/, label: 'internal-dotify' },
  { re: /hanaaaca/, label: 'coworker handle' },
  { re: /ulfa\.mufida/, label: 'coworker handle' },
  { re: /kontribusi\/mattermost-agent/, label: 'local mattermost-agent checkout' },
  { re: /dot-system\//, label: 'dot-system/' },
  { re: /timeEntities/, label: 'timeEntities' },
  { re: /resolveAttendanceConfirmation/, label: 'resolveAttendanceConfirmation' },
  { re: /attendance-confirmations/, label: 'attendance-confirmations' }
];

test('packaged files do not embed real client tickets, schema, or machine paths', () => {
  const files = walk(ROOT).filter((abs) => {
    const r = rel(abs);
    return !r.startsWith('tests/no-company-leak.test.js');
  });
  const hits = [];
  for (const abs of files) {
    const r = rel(abs);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;

    if (r !== 'bin/ai-engineering-loop.js' && /gitlab\.dot\.co\.id/.test(text)) {
      hits.push(`${r}: gitlab.dot.co.id (allowed only as adapter auto-detect in bin/)`);
    }
    if (r === 'bin/ai-engineering-loop.js' && /gitlab\.dot\.co\.id\/.+/.test(text)) {
      hits.push(`${r}: gitlab.dot.co.id with a path (ticket URL)`);
    }

    const inSensitiveTree = r.startsWith('adapters/') || r.startsWith('examples/');
    if (inSensitiveTree && /\/Users\/egagofur/.test(text)) {
      hits.push(`${r}: /Users/egagofur`);
    }

    for (const { re, label } of FINGERPRINTS) {
      if (re.test(text)) hits.push(`${r}: ${label}`);
    }
  }
  assert.deepStrictEqual(hits, []);
});
