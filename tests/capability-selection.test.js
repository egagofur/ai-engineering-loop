const test = require('node:test');
const assert = require('node:assert');
const {
  EXECUTION_MODES,
  createCapabilityEvidence,
  selectExecutionMode,
  formatExecutionReport
} = require('../lib/orchestration.js');

// Test 1, 2, 3, 4: Priority fallthrough down to Artifact Isolation
test('1, 2, 3, 4. Capability priority fallthrough selects CONTEXT_ISOLATION_ONLY when higher modes are unavailable', () => {
  const registry = {
    nativeSubagent: createCapabilityEvidence({
      mechanism: 'native-subagent-tool',
      classification: 'UNAVAILABLE',
      available: false,
      reason: 'No general subagent tool exposed in active prompt'
    }),
    sdkAgent: createCapabilityEvidence({
      mechanism: 'google-antigravity-python-sdk',
      classification: 'UNAVAILABLE',
      available: false,
      reason: 'Package not installed in Python environment'
    }),
    headlessProcessAgent: createCapabilityEvidence({
      mechanism: 'claude-code-cli',
      classification: 'UNAVAILABLE',
      available: false,
      reason: 'CLI unauthenticated'
    }),
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true,
      commandOrApi: 'buildReviewContextBarrier',
      result: 'Verified 100% prompt history exclusion',
      modelExecutionProven: false,
      independentContextProven: false
    })
  };

  const selected = selectExecutionMode(registry);
  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
  assert.strictEqual(selected.isIndependentExecutionProven, false);
});

// Test 5: Documentation-only evidence cannot activate a capability
test('5. Documentation-only evidence cannot activate a capability', () => {
  const docOnlyEvidence = createCapabilityEvidence({
    mechanism: 'doc-mention-subagent-true',
    classification: 'DOCUMENTATION_ONLY',
    available: true,
    isDocumentationOnly: true,
    modelExecutionProven: false,
    reason: 'subagent: true present in AGENT.md YAML but no execution proof'
  });

  const registry = {
    nativeSubagent: docOnlyEvidence,
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  };

  const selected = selectExecutionMode(registry);
  // Must reject native subagent and fall through to artifact isolation
  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
});

// Test 6: agentapi.send-message cannot activate an agent capability
test('6. agentapi.send-message cannot activate an agent capability (IPC only)', () => {
  const ipcEvidence = createCapabilityEvidence({
    mechanism: 'antigravity-agentapi-send-message',
    classification: 'NOT_AN_AGENT_EXECUTION_CAPABILITY',
    available: true,
    commandOrApi: 'agentapi send-message',
    result: 'Message delivered to existing conversation',
    modelExecutionProven: false
  });

  const registry = {
    nativeSubagent: ipcEvidence,
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  };

  const selected = selectExecutionMode(registry);
  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
});

// Test 7: new-conversation failure cannot activate an agent capability
test('7. new-conversation failure cannot activate an agent capability', () => {
  const rpcFailedEvidence = createCapabilityEvidence({
    mechanism: 'antigravity-agentapi-new-conversation',
    classification: 'UNAVAILABLE',
    available: false,
    commandOrApi: 'agentapi new-conversation',
    result: 'rpc error: project_id is required when providing project_env_config',
    modelExecutionProven: false,
    reason: 'new-conversation reaches the Language Server but is blocked by project_id authorization in the current standalone workspace'
  });

  const registry = {
    nativeSubagent: rpcFailedEvidence,
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  };

  const selected = selectExecutionMode(registry);
  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
});

// Test 8: Missing model response cannot activate an independent agent
test('8. Missing model response cannot activate an independent agent', () => {
  const threadWithoutModelResponse = createCapabilityEvidence({
    mechanism: 'hypothetical-empty-thread',
    classification: 'THREAD_CREATED_WITHOUT_RESPONSE',
    available: true,
    childConversationId: 'child-conv-999',
    modelExecutionProven: false, // No response produced
    independentContextProven: false
  });

  const registry = {
    nativeSubagent: threadWithoutModelResponse,
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  };

  const selected = selectExecutionMode(registry);
  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
});

// Test 9: Artifact isolation is reported as CONTEXT_ISOLATION_ONLY with Independent LLM execution: NOT PROVEN
test('9. Truthful report format strictly labels CONTEXT_ISOLATION_ONLY as NOT PROVEN', () => {
  const report = formatExecutionReport({
    selectedMode: EXECUTION_MODES.CONTEXT_ISOLATION_ONLY
  });

  assert.ok(report.includes('Execution Mode: CONTEXT_ISOLATION_ONLY'));
  assert.ok(report.includes('Independent LLM Execution: NOT PROVEN'));
  assert.strictEqual(report.includes('Independent Sub-Agent Review'), false);
  assert.strictEqual(report.includes('Multi-Agent Review'), false);
});

// Test 10: No unsupported execution mode can be selected
test('10. No unsupported execution mode can be selected (falls to UNAVAILABLE if all false)', () => {
  const emptyRegistry = {
    nativeSubagent: { available: false },
    sdkAgent: { available: false },
    headlessProcessAgent: { available: false },
    artifactIsolation: { available: false }
  };

  const selected = selectExecutionMode(emptyRegistry);
  assert.strictEqual(selected.id, EXECUTION_MODES.UNAVAILABLE.id);
  assert.strictEqual(selected.isIndependentExecutionProven, false);
});

// Test 11: True Independent Agent is selected ONLY when positive evidence is present
test('11. TRUE_INDEPENDENT_AGENT is selected ONLY when full execution and independent context are proven', () => {
  const fullyProvenEvidence = createCapabilityEvidence({
    mechanism: 'native-subagent-runtime-tool',
    classification: 'TRUE_INDEPENDENT_AGENT',
    available: true,
    commandOrApi: 'invoke_subagent',
    childConversationId: 'child-1234',
    modelExecutionProven: true,
    independentContextProven: true,
    historyInherited: false,
    result: 'Actual child response captured: CHILD_AGENT_EXECUTION_OK'
  });

  const registry = {
    nativeSubagent: fullyProvenEvidence,
    artifactIsolation: { available: true }
  };

  const selected = selectExecutionMode(registry);
  assert.strictEqual(selected.id, EXECUTION_MODES.TRUE_INDEPENDENT_AGENT.id);
  assert.strictEqual(selected.isIndependentExecutionProven, true);
});
