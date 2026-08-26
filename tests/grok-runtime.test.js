const test = require('node:test');
const assert = require('node:assert');
const {
  EXECUTION_MODES,
  EXECUTION_MODE_ALIASES,
  GROK_FORBIDDEN_REVIEW_TYPES,
  resolveExecutionModeId,
  createCapabilityEvidence,
  selectExecutionMode,
  detectGrokRuntime,
  createGrokCapabilityEvidence,
  buildGrokReviewSpawnPlan,
  formatExecutionReport
} = require('../lib/orchestration.js');

function fakeFs(existingPaths) {
  return {
    existsSync: (p) => existingPaths.includes(p)
  };
}

test('Grok spawn_subagent with full execution proof selects TRUE_INDEPENDENT_AGENT', () => {
  const nativeSubagent = createGrokCapabilityEvidence({
    invocationAvailable: true,
    childConversationId: 'grok-child-da-01',
    childModelResponse: 'Finding ledger JSON emitted',
    executionIdentity: 'spawn_subagent:grok-child-da-01',
    independentContextProven: true,
    historyInherited: false
  });

  const selected = selectExecutionMode({
    nativeSubagent,
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  });

  assert.strictEqual(selected.id, EXECUTION_MODES.TRUE_INDEPENDENT_AGENT.id);
  assert.strictEqual(selected.isIndependentExecutionProven, true);
  assert.strictEqual(nativeSubagent.commandOrApi, 'spawn_subagent');
});

test('GROK_SUBAGENTS=0 disables invocation even when grok binary exists', () => {
  const grokBin = '/tmp/fake-grok-home/bin/grok';
  const runtime = detectGrokRuntime(
    { GROK_HOME: '/tmp/fake-grok-home', GROK_SUBAGENTS: '0', HOME: '/tmp' },
    fakeFs([grokBin])
  );

  assert.strictEqual(runtime.host, 'grok-cli');
  assert.strictEqual(runtime.configurationSupported, true);
  assert.strictEqual(runtime.invocationAvailable, false);
  assert.strictEqual(runtime.executionProven, false);
  assert.match(runtime.reason, /GROK_SUBAGENTS=0/);

  const selected = selectExecutionMode({
    nativeSubagent: createGrokCapabilityEvidence({
      invocationAvailable: runtime.invocationAvailable,
      reason: runtime.reason
    }),
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  });

  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
});

test('Grok binary present with default subagents maps to INVOCATION_AVAILABLE, not execution proven', () => {
  const grokBin = '/tmp/fake-grok-home/bin/grok';
  const runtime = detectGrokRuntime(
    { GROK_HOME: '/tmp/fake-grok-home', HOME: '/tmp' },
    fakeFs([grokBin])
  );

  assert.strictEqual(runtime.invocationAvailable, true);
  assert.strictEqual(runtime.executionProven, false);

  const evidence = createGrokCapabilityEvidence({
    invocationAvailable: true
  });

  const selected = selectExecutionMode({
    nativeSubagent: evidence,
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  });

  assert.strictEqual(evidence.classification, 'INVOCATION_AVAILABLE');
  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
});

test('resume_from Maker transcript cannot activate TRUE_INDEPENDENT_AGENT', () => {
  const tainted = createGrokCapabilityEvidence({
    invocationAvailable: true,
    childConversationId: 'grok-child-resume',
    childModelResponse: 'I remember the Maker rationale',
    executionIdentity: 'spawn_subagent:resume',
    independentContextProven: true,
    resumeFrom: 'maker-subagent-id'
  });

  const selected = selectExecutionMode({
    nativeSubagent: tainted,
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  });

  assert.strictEqual(tainted.historyInherited, true);
  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
});

test('caveman:cavecrew-reviewer cannot serve as Devil\'s Advocate', () => {
  const compressed = createCapabilityEvidence({
    mechanism: 'caveman:cavecrew-reviewer',
    classification: 'GROK_COMPRESSED_REVIEW_PRESET',
    available: true,
    invocationAvailable: true,
    executionProven: true,
    childConversationId: 'cave-1',
    executionIdentity: 'cave-1',
    childModelResponse: 'path:line: 🔴 BLOCKER: bug. fix it.',
    modelExecutionProven: true,
    independentContextProven: true
  });

  const selected = selectExecutionMode({
    nativeSubagent: compressed,
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  });

  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
  assert.ok(GROK_FORBIDDEN_REVIEW_TYPES.includes('caveman:cavecrew-reviewer'));
});

test('Skill aliases resolve to canonical execution mode ids', () => {
  assert.strictEqual(resolveExecutionModeId('NATIVE_SUBAGENT'), 'TRUE_INDEPENDENT_AGENT');
  assert.strictEqual(resolveExecutionModeId('SDK_AGENT'), 'ISOLATED_AGENT_INSTANCE');
  assert.strictEqual(resolveExecutionModeId('HEADLESS_SUBPROCESS'), 'FRESH_PROCESS_AGENT');
  assert.strictEqual(resolveExecutionModeId('ARTIFACT_ISOLATED_REVIEW'), 'CONTEXT_ISOLATION_ONLY');
  assert.strictEqual(EXECUTION_MODE_ALIASES.NATIVE_SUBAGENT, EXECUTION_MODES.TRUE_INDEPENDENT_AGENT.id);
});

test('Grok DA/Judge spawn plan is fresh, execute-only, and forbids compressed review types', () => {
  const da = buildGrokReviewSpawnPlan({
    role: 'devil-advocate',
    iteration: 2,
    artifactPaths: { goalContract: 'goal.md', gitDiff: 'diff.patch' }
  });

  assert.strictEqual(da.tool, 'spawn_subagent');
  assert.strictEqual(da.subagent_type, 'devil-advocate');
  assert.strictEqual(da.fallback_subagent_type, 'general-purpose');
  assert.strictEqual(da.description, '[devil-advocate] review iteration 2');
  assert.strictEqual(da.background, false);
  assert.strictEqual(da.capability_mode, 'execute');
  assert.strictEqual(da.isolation, 'none');
  assert.strictEqual(da.resume_from, null);
  assert.ok(da.forbidden_types.includes('caveman:cavecrew-reviewer'));
  assert.strictEqual(da.artifactPaths.goalContract, 'goal.md');

  const judge = buildGrokReviewSpawnPlan({ role: 'judge', iteration: 2 });
  assert.strictEqual(judge.subagent_type, 'judge');
  assert.strictEqual(judge.description, '[judge] evaluate iteration 2');
  assert.strictEqual(judge.resume_from, null);
});

test('buildGrokReviewSpawnPlan rejects unknown roles', () => {
  assert.throws(
    () => buildGrokReviewSpawnPlan({ role: 'caveman:cavecrew-reviewer' }),
    /must be devil-advocate or judge/
  );
});

test('Grok proven spawn report discloses independent execution', () => {
  const report = formatExecutionReport({
    selectedMode: EXECUTION_MODES.TRUE_INDEPENDENT_AGENT,
    capabilityRegistry: {
      nativeSubagent: { invocationAvailable: true }
    }
  });

  assert.match(report, /Execution Mode: TRUE_INDEPENDENT_AGENT/);
  assert.match(report, /Independent LLM Execution: PROVEN/);
  assert.match(report, /Native Subagent Invocation: AVAILABLE/);
});
