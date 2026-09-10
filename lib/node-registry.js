'use strict';

const NODE_TYPES = Object.freeze({
  'goal-contract': Object.freeze({
    label: 'Goal Contract',
    category: 'safety',
    builtIn: true,
    mutation: false,
    sideEffect: false,
    modelRequired: false,
    legacyGate: 'goal'
  }),
  agent: Object.freeze({
    label: 'Agent Analysis',
    category: 'custom',
    builtIn: false,
    mutation: false,
    sideEffect: false,
    modelRequired: true
  }),
  command: Object.freeze({
    label: 'Deterministic Command',
    category: 'custom',
    builtIn: false,
    mutation: true,
    sideEffect: false,
    modelRequired: false
  }),
  condition: Object.freeze({
    label: 'Condition',
    category: 'control',
    builtIn: false,
    mutation: false,
    sideEffect: false,
    modelRequired: false
  }),
  approval: Object.freeze({
    label: 'Human Approval',
    category: 'safety',
    builtIn: false,
    mutation: false,
    sideEffect: false,
    modelRequired: false
  }),
  'artifact-check': Object.freeze({
    label: 'Artifact Check',
    category: 'control',
    builtIn: false,
    mutation: false,
    sideEffect: false,
    modelRequired: false
  }),
  maker: Object.freeze({
    label: 'Maker',
    category: 'safety',
    builtIn: true,
    mutation: true,
    sideEffect: false,
    modelRequired: true,
    legacyGate: 'maker'
  }),
  verification: Object.freeze({
    label: 'Verification',
    category: 'safety',
    builtIn: true,
    mutation: false,
    sideEffect: false,
    modelRequired: false,
    legacyGate: 'verification'
  }),
  'devil-advocate': Object.freeze({
    label: "Devil's Advocate",
    category: 'safety',
    builtIn: true,
    mutation: false,
    sideEffect: false,
    modelRequired: true,
    legacyGate: 'review'
  }),
  judge: Object.freeze({
    label: 'Judge',
    category: 'safety',
    builtIn: true,
    mutation: false,
    sideEffect: false,
    modelRequired: true,
    legacyGate: 'judge'
  }),
  report: Object.freeze({
    label: 'Report',
    category: 'terminal',
    builtIn: true,
    mutation: false,
    sideEffect: false,
    modelRequired: false,
    legacyGate: 'report'
  }),
  delivery: Object.freeze({
    label: 'Delivery',
    category: 'terminal',
    builtIn: true,
    mutation: false,
    sideEffect: true,
    modelRequired: false,
    legacyGate: 'delivery'
  })
});

const CONDITION_OPERATORS = Object.freeze([
  'equals',
  'notEquals',
  'contains',
  'matchesAny',
  'exists',
  'isEmpty',
  'greaterThan',
  'lessThan'
]);

const CONDITION_FIELDS = Object.freeze([
  'run.mode',
  'run.state',
  'run.iteration',
  'run.task'
]);

const FORBIDDEN_COMMANDS = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'node',
  'node.exe',
  'python',
  'python3',
  'ruby',
  'perl'
]);

function getNodeType(type) {
  return NODE_TYPES[type] || null;
}

module.exports = {
  NODE_TYPES,
  CONDITION_OPERATORS,
  CONDITION_FIELDS,
  FORBIDDEN_COMMANDS,
  getNodeType
};
