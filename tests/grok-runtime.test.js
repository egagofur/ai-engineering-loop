const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  EXECUTION_MODES,
  EXECUTION_MODE_ALIASES,
  resolveExecutionModeId,
  detectGrokRuntime
} = require('../lib/orchestration.js');

function fakeFs(existingPaths) {
  return {
    existsSync: (p) => existingPaths.includes(p)
  };
}

test('GROK_SUBAGENTS=0 disables invocation even when grok binary exists', () => {
  const grokHome = path.join('tmp', 'fake-grok-home');
  const grokBin = path.join(grokHome, 'bin', 'grok');
  const runtime = detectGrokRuntime(
    { GROK_HOME: grokHome, GROK_SUBAGENTS: '0', HOME: path.join('tmp') },
    fakeFs([grokBin])
  );

  assert.strictEqual(runtime.host, 'grok-cli');
  assert.strictEqual(runtime.configurationSupported, true);
  assert.strictEqual(runtime.invocationAvailable, false);
  assert.strictEqual(runtime.executionProven, false);
  assert.match(runtime.reason, /GROK_SUBAGENTS=0/);
});

test('Grok binary present with default subagents is invocation available, not execution proven', () => {
  const grokHome = path.join('tmp', 'fake-grok-home');
  const grokBin = path.join(grokHome, 'bin', 'grok');
  const runtime = detectGrokRuntime(
    { GROK_HOME: grokHome, HOME: path.join('tmp') },
    fakeFs([grokBin])
  );

  assert.strictEqual(runtime.invocationAvailable, true);
  assert.strictEqual(runtime.executionProven, false);
  assert.strictEqual(runtime.commandOrApi, 'spawn_subagent');
});

test('Grok runtime recognizes Windows command shims', () => {
  const grokHome = path.join('tmp', 'fake-grok-home');
  const grokBin = path.join(grokHome, 'bin', 'grok.cmd');
  const runtime = detectGrokRuntime(
    { GROK_HOME: grokHome },
    fakeFs([grokBin])
  );

  assert.strictEqual(runtime.host, 'grok-cli');
  assert.strictEqual(runtime.grokBin, grokBin);
  assert.strictEqual(runtime.invocationAvailable, true);
});

test('Grok runtime is unknown when no binary is present', () => {
  const runtime = detectGrokRuntime({ GROK_HOME: path.join('tmp', 'none') }, fakeFs([]));
  assert.strictEqual(runtime.host, 'unknown');
  assert.strictEqual(runtime.invocationAvailable, false);
});

test('Skill aliases resolve to canonical execution mode ids', () => {
  assert.strictEqual(resolveExecutionModeId('NATIVE_SUBAGENT'), 'TRUE_INDEPENDENT_AGENT');
  assert.strictEqual(resolveExecutionModeId('SDK_AGENT'), 'ISOLATED_AGENT_INSTANCE');
  assert.strictEqual(resolveExecutionModeId('HEADLESS_SUBPROCESS'), 'FRESH_PROCESS_AGENT');
  assert.strictEqual(resolveExecutionModeId('ARTIFACT_ISOLATED_REVIEW'), 'CONTEXT_ISOLATION_ONLY');
  assert.strictEqual(EXECUTION_MODE_ALIASES.NATIVE_SUBAGENT, EXECUTION_MODES.TRUE_INDEPENDENT_AGENT.id);
});
