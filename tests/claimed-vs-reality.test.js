'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseClaimedVsReality, readyForDa } = require('../lib/claimed-vs-reality.js');

test('AC-4 filled table is ready for DA', () => {
  const md = `# Claimed vs Reality

| AC | Claimed | Reality |
|---|---|---|
| AC-1 | overlay writes workflow.md | npm test exit 0; AC-1 test passed |
| AC-2 | missing overlay is default | npm test exit 0; AC-2 test passed |
`;
  const { rows } = parseClaimedVsReality(md);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(readyForDa(md), true);
});

test('AC-5 empty Reality or seems-green is not ready for DA', () => {
  assert.strictEqual(readyForDa(''), false);
  assert.strictEqual(readyForDa('# Claimed vs Reality\n'), false);
  const emptyReality = `| AC | Claimed | Reality |\n|---|---|---|\n| AC-1 | tests pass |  |\n`;
  assert.strictEqual(readyForDa(emptyReality), false);
  const seems = `| AC | Claimed | Reality |\n|---|---|---|\n| AC-1 | tests pass | seems green |\n`;
  assert.strictEqual(readyForDa(seems), false);
});
