'use strict';

// #57: recipe `audit` / REPORT_ONLY review policy and a non-contradictory header.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  EXECUTION_MODES,
  formatExecutionReport,
  reportOnlyReviewPlan,
  DEFAULT_ISOLATION_REASON
} = require('../lib/orchestration.js');
const { HOSTS } = require('../lib/hosts/registry.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('header: CONTEXT_ISOLATION_ONLY with an AVAILABLE subagent tool always states the reason', () => {
  const available = { nativeSubagent: { invocationAvailable: true } };
  const implicit = formatExecutionReport({ selectedMode: EXECUTION_MODES.CONTEXT_ISOLATION_ONLY, capabilityRegistry: available });
  assert.match(implicit, new RegExp(`^Execution Mode: CONTEXT_ISOLATION_ONLY \\(reason: ${DEFAULT_ISOLATION_REASON}\\)$`, 'm'));
  assert.match(implicit, /^Native Subagent Invocation: AVAILABLE$/m);
  const explicit = formatExecutionReport({ selectedMode: EXECUTION_MODES.CONTEXT_ISOLATION_ONLY, capabilityRegistry: available, reason: 'invoke_subagent failed' });
  assert.match(explicit, /^Execution Mode: CONTEXT_ISOLATION_ONLY \(reason: invoke_subagent failed\)$/m);
  // Independent and no-subagent headers are unchanged.
  const proven = formatExecutionReport({ selectedMode: EXECUTION_MODES.TRUE_INDEPENDENT_AGENT, capabilityRegistry: available });
  assert.match(proven, /^Execution Mode: TRUE_INDEPENDENT_AGENT$/m);
  const none = formatExecutionReport({ selectedMode: EXECUTION_MODES.CONTEXT_ISOLATION_ONLY, capabilityRegistry: { nativeSubagent: { invocationAvailable: false } } });
  assert.match(none, /^Execution Mode: CONTEXT_ISOLATION_ONLY$/m);
});

test('audit review plan: subagent hosts spawn ONE devil-advocate (no Judge); others review in-session with a reason', () => {
  const withSubagent = reportOnlyReviewPlan({ nativeSubagent: { invocationAvailable: true } });
  assert.deepStrictEqual(withSubagent, { spawn: 'devil-advocate', judge: false, expectedMode: 'TRUE_INDEPENDENT_AGENT', reason: null });
  const without = reportOnlyReviewPlan({ nativeSubagent: { invocationAvailable: false } });
  assert.strictEqual(without.spawn, null);
  assert.strictEqual(without.judge, false);
  assert.strictEqual(without.expectedMode, 'CONTEXT_ISOLATION_ONLY');
  assert.ok(without.reason);
  assert.strictEqual(reportOnlyReviewPlan().spawn, null, 'unknown capability defaults to in-session');
});

test('audit policy is documented once for every host and reaches every installed skill copy', () => {
  for (const rel of ['.claude/skills/ai-engineering-loop', '.agents/skills/ai-engineering-loop']) {
    const maker = read(`${rel}/references/loop-maker.md`);
    assert.match(maker, /## REPORT_ONLY report review \(recipe `audit`\)/);
    assert.match(maker, /ONE fresh `devil-advocate`/);
    assert.match(maker, /No Judge/);
    assert.match(maker, /"reason"/);
    assert.match(read(`${rel}/references/loop-hosts.md`), /REPORT_ONLY \(`audit`\) uses the same spawn tool/);
    assert.match(read(`${rel}/references/loop-review.md`), /REPORT_ONLY runs skip these stages/);
    assert.match(read(`${rel}/SKILL.md`), /\(reason: <why>\)/);
  }
  // Every host with a reviewer agent can run the audit review with the same agent.
  for (const host of HOSTS.filter((h) => h.agents)) assert.ok(host.agents.format, host.id);
  assert.match(read('core/orchestration-model.md'), /REPORT_ONLY \(recipe `audit`\) policy/);
});
