'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { readDoc } = require('../lib/docs.js');

test('ael docs verification-one-pager is a short page on gates, verify, and the Judge', () => {
  const doc = readDoc('verification-one-pager');
  assert.strictEqual(doc.rel, 'core/verification-one-pager.md');
  assert.ok(Buffer.byteLength(doc.text) <= 2500, `${doc.bytes} bytes`);
  for (const word of ['Goal', 'diff.patch', 'verification.json', 'exit code', 'findings.json', 'PASS', 'ITERATE', 'ESCALATE', 'deliver --approve', 'L1', 'L2', 'L3', 'docs verification-loop']) {
    assert.ok(doc.text.includes(word), word);
  }
});
