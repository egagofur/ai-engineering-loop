'use strict';

// C-04: every gate failure carries why and fix, so agents can self-correct.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function gateErrorCalls(source) {
  const calls = [];
  let index = source.indexOf('gateError(');
  while (index !== -1) {
    if (!source.slice(Math.max(0, index - 9), index).includes('function')) {
      let depth = 0;
      let end = index + 'gateError'.length;
      for (; end < source.length; end += 1) {
        const ch = source[end];
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      calls.push(source.slice(index, end + 1));
    }
    index = source.indexOf('gateError(', index + 1);
  }
  return calls;
}

test('every gateError call in lib/gates.js gives a why and a fix', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'gates.js'), 'utf8');
  const calls = gateErrorCalls(source);
  assert.ok(calls.length >= 30, `found ${calls.length} calls`);
  const missing = calls.filter((call) => !/\bwhy:/.test(call) || !/\bfix:/.test(call));
  assert.deepStrictEqual(missing.map((call) => call.slice(0, 80)), []);
});

test('gateError exposes why and fix on the error', () => {
  const { applyGate } = require('../lib/gates.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-why-'));
  assert.throws(() => applyGate(root, 'nope', { runId: 'x' }), (err) => err.code === 'GATE_FAILED' && /Use one of/.test(err.fix) && Boolean(err.why));
});
