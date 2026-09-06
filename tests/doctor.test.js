const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { runDoctor } = require('../lib/doctor.js');

test('published source tree passes public beta diagnostics', () => {
  const result = runDoctor(path.join(__dirname, '..'));
  assert.strictEqual(
    result.ok,
    true,
    result.checks.filter((check) => !check.passed).map((check) => `${check.id}: ${check.detail}`).join('\n')
  );
  assert.ok(result.checks.length >= 6);
});
