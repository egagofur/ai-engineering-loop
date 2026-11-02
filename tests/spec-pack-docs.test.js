'use strict';

// Issue #100: spec pack guide, README line, attribution.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readDoc } = require('../lib/docs.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('docs spec-pack resolves and stays within ~3 KB', () => {
  const doc = readDoc('spec-pack');
  assert.strictEqual(doc.rel, 'core/spec-pack.md');
  assert.ok(Buffer.byteLength(doc.text) <= 3072, `${doc.bytes} bytes`);
  for (const word of ['ael-spec-brainstorm', '--from-design', 'CONTEXT_ISOLATION_ONLY', 'sync-spec-pack.js --pull', 'T0/T1']) {
    assert.ok(doc.text.includes(word), word);
  }
});

test('README, loop-risky and THIRD_PARTY_NOTICES point at the spec pack', () => {
  assert.match(read('README.md'), /sync-hosts --pack spec .*docs spec-pack/);
  assert.match(read('.agents/skills/ael/references/loop-risky.md'), /docs spec-pack/);
  const notices = read('THIRD_PARTY_NOTICES.md');
  for (const word of ['Apache License 2.0', 'Google LLC', 'egagofur/elephant-goldfish-model', 'vendor/egm/UPSTREAM.json', 'core/spec-pack.md']) {
    assert.ok(notices.includes(word), word);
  }
});
