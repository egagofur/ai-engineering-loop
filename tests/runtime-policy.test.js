const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_POLICY,
  assertModeAllowed,
  loadPolicy,
  policyPath,
  updatePolicy
} = require('../lib/runtime-policy.js');
const { RUN_MODES } = require('../lib/run-state.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-policy-'));
}

test('runtime policy defaults to assisted and denies unattended', () => {
  const root = tempRepo();
  assert.deepStrictEqual(loadPolicy(root), DEFAULT_POLICY);
  assert.doesNotThrow(() => assertModeAllowed(root, RUN_MODES.ASSISTED));
  assert.throws(
    () => assertModeAllowed(root, RUN_MODES.UNATTENDED),
    (err) => err.code === 'UNATTENDED_DISABLED'
  );
});

test('unattended requires an explicit persistent opt-in', () => {
  const root = tempRepo();
  const policy = updatePolicy(root, {
    allowUnattended: true,
    defaultMode: RUN_MODES.UNATTENDED
  });
  assert.strictEqual(policy.defaultMode, RUN_MODES.UNATTENDED);
  assert.doesNotThrow(() => assertModeAllowed(root, RUN_MODES.UNATTENDED));
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(policyPath(root)).mode & 0o777, 0o600);
  }
});

test('invalid limits fail closed', () => {
  const root = tempRepo();
  assert.throws(
    () => updatePolicy(root, { dailyTokenLimit: 0 }),
    (err) => err.code === 'INVALID_RUNTIME_POLICY'
  );
});
