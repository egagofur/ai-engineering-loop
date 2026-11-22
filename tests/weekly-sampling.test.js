'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readDoc } = require('../lib/docs.js');

test('the weekly process-sampling playbook is doc-only and shipped for ael docs', () => {
  const playbook = fs.readFileSync(path.join(__dirname, '..', 'docs', 'playbooks', 'weekly-process-sampling.md'), 'utf8').replace(/\r\n/g, '\n');
  const doc = readDoc('weekly-process-sampling');
  assert.strictEqual(doc.rel, 'core/weekly-process-sampling.md');
  assert.strictEqual(doc.text.trim(), playbook.trim());
  for (const word of ['three', 'state.json', 'verification.json', 'humanApproved', 'Do not patch history']) {
    assert.ok(playbook.includes(word), word);
  }
});
