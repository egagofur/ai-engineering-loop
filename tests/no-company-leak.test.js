'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { listPackageFiles } = require('../lib/package-audit.js');

const ROOT = path.join(__dirname, '..');

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
  const files = listPackageFiles(ROOT);
  const hits = [];
  for (const r of files) {
    const abs = path.join(ROOT, r);
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

    if (/\/Users\/egagofur/.test(text)) {
      hits.push(`${r}: /Users/egagofur`);
    }
    if (!['lib/package-audit.js', 'tests/package-audit.test.js'].includes(r) && /file:\/\/\//.test(text)) {
      hits.push(`${r}: local file URL`);
    }

    for (const { re, label } of FINGERPRINTS) {
      if (re.test(text)) hits.push(`${r}: ${label}`);
    }
  }
  assert.deepStrictEqual(hits, []);
});
