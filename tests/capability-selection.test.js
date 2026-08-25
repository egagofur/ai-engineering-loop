const test = require('node:test');
const assert = require('node:assert');
const {
  EXECUTION_MODES,
  createCapabilityEvidence,
  selectExecutionMode,
  formatExecutionReport
} = require('../lib/orchestration.js');

// Test 1: Distinction between CONFIGURATION_SUPPORTED and INVOCATION_AVAILABLE / EXECUTION_PROVEN
test('1. CONFIGURATION_SUPPORTED = true, INVOCATION_AVAILABLE = false, EXECUTION_PROVEN = false resolves to CONTEXT_ISOLATION_ONLY', () => {
  const antigravityDiscovery = {
    nativeSubagent: createCapabilityEvidence({
      mechanism: 'antigravity-custom-agent-config',
      classification: 'CONFIGURATION_SUPPORTED_WITHOUT_INVOCATION_TOOL',
      configurationSupported: true, // .agents/plugins/.../AGENT.md with subagent: true is discoverable
      invocationAvailable: false,   // No invoke_subagent tool in active prompt
      executionProven: false,       // No child execution occurred
      isDocumentationOnly: false,
      reason: 'Antigravity custom subagent configuration is supported/discoverable, but native subagent invocation is not exposed or executable from the current standalone agent runtime'
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

  const selected = selectExecutionMode(antigravityDiscovery);
  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
  assert.strictEqual(selected.isIndependentExecutionProven, false);
});

// Test 2: browser_subagent is browser automation and CANNOT activate LLM subagent execution
test('2. browser_subagent cannot activate LLM subagent execution mode', () => {
  const browserSubagentEvidence = createCapabilityEvidence({
    mechanism: 'browser_subagent-tool',
    classification: 'BROWSER_AUTOMATION_TOOL',
    available: true,
    isBrowserAutomationOnly: true,
    reason: 'browser_subagent is scoped to DOM/browser navigation automation, not general LLM code review'
  });

  const registry = {
    nativeSubagent: browserSubagentEvidence,
    artifactIsolation: createCapabilityEvidence({
      mechanism: 'clean-slate-artifact-barrier',
      classification: 'CONTEXT_ISOLATION_ONLY',
      available: true
    })
  };

  const selected = selectExecutionMode(registry);
  assert.strictEqual(selected.id, EXECUTION_MODES.CONTEXT_ISOLATION_ONLY.id);
});

// Test 3: agentapi.send-message is IPC communication and cannot activate an agent capability
test('3. agentapi.send-message is IPC_MESSAGE_DISPATCH and cannot activate agent capability', () => {
  const ipcEvidence = createCapabilityEvidence({
    mechanism: 'antigravity-agentapi-send-message',
    classification: 'IPC_MESSAGE_DISPATCH',
    available: true,
    commandOrApi: 'agentapi send-message',
    result: 'Message delivered to existing conversation over gRPC',
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

// Test 4: agentapi.new-conversation failure cannot activate an agent capability
test('4. agentapi.new-conversation failure cannot activate an agent capability', () => {
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

// Test 5: Missing child model response cannot activate an independent agent
test('5. Missing model response cannot activate an independent agent', () => {
  const threadWithoutModelResponse = createCapabilityEvidence({
    mechanism: 'child-thread-without-response',
    classification: 'THREAD_CREATED_WITHOUT_RESPONSE',
    available: true,
    childConversationId: 'child-conv-1234',
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

// Test 6: Truthful report format strictly produces the required 4-line disclosure
test('6. Truthful report format strictly produces the required 4-line disclosure', () => {
  const capabilityRegistry = {
    nativeSubagent: {
      invocationAvailable: false
    }
  };

  const report = formatExecutionReport({
    selectedMode: EXECUTION_MODES.CONTEXT_ISOLATION_ONLY,
    capabilityRegistry
  });

  const expected = [
    'Execution Mode: CONTEXT_ISOLATION_ONLY',
    'Independent LLM Execution: NOT PROVEN',
    'Native Subagent Invocation: UNAVAILABLE',
    'Review Method: Clean-Slate Artifact Isolation Barrier'
  ].join('\n');

  assert.strictEqual(report, expected);
});

// Test 7: TRUE_INDEPENDENT_AGENT is selected ONLY when full execution evidence is proven
test('7. TRUE_INDEPENDENT_AGENT is selected ONLY when child session, response, identity, and context are proven', () => {
  const fullyProvenEvidence = createCapabilityEvidence({
    mechanism: 'native-subagent-runtime-tool',
    classification: 'TRUE_INDEPENDENT_AGENT',
    available: true,
    commandOrApi: 'invoke_subagent',
    childConversationId: 'child-session-9876',
    executionIdentity: 'grpc-stream-552',
    childModelResponse: 'CHILD_AGENT_EXECUTION_OK',
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

// Test 8: Fallback to UNAVAILABLE when all modes including artifact isolation are unavailable
test('8. Fallback to UNAVAILABLE when all modes are false', () => {
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
