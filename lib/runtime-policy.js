'use strict';

const fs = require('fs');
const path = require('path');
const {
  RUN_MODES,
  atomicWriteJson
} = require('./run-state.js');

const DEFAULT_POLICY = Object.freeze({
  schemaVersion: 1,
  defaultMode: RUN_MODES.ASSISTED,
  allowUnattended: false,
  requireSandboxForUnattended: true,
  perRunTokenLimit: 50_000,
  dailyTokenLimit: 200_000,
  killSwitch: false
});

function policyPath(rootDir) {
  return path.join(rootDir, '.ai-engineering-loop', 'runtime-policy.json');
}

function normalizeMode(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().replace(/-/g, '_').toUpperCase();
  if (!Object.hasOwn(RUN_MODES, normalized)) {
    const err = new Error(`Unknown run mode: ${value}. Use report-only|assisted|unattended`);
    err.code = 'INVALID_RUN_MODE';
    throw err;
  }
  return RUN_MODES[normalized];
}

function validatePolicy(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['runtime policy must be a JSON object'];
  }
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  try {
    normalizeMode(value.defaultMode);
  } catch (cause) {
    errors.push(cause.message);
  }
  for (const key of ['allowUnattended', 'requireSandboxForUnattended', 'killSwitch']) {
    if (typeof value[key] !== 'boolean') errors.push(`${key} must be boolean`);
  }
  for (const key of ['perRunTokenLimit', 'dailyTokenLimit']) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0) {
      errors.push(`${key} must be a positive integer`);
    }
  }
  return errors;
}

function loadPolicy(rootDir) {
  const filePath = policyPath(rootDir);
  if (!fs.existsSync(filePath)) return { ...DEFAULT_POLICY };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    const err = new Error(`Unable to read runtime policy: ${cause.message}`);
    err.code = 'INVALID_RUNTIME_POLICY';
    throw err;
  }
  const policy = { ...DEFAULT_POLICY, ...parsed };
  const errors = validatePolicy(policy);
  if (errors.length) {
    const err = new Error(`Invalid runtime policy: ${errors.join('; ')}`);
    err.code = 'INVALID_RUNTIME_POLICY';
    err.details = errors;
    throw err;
  }
  policy.defaultMode = normalizeMode(policy.defaultMode);
  return policy;
}

function writePolicy(rootDir, policy) {
  const next = { ...DEFAULT_POLICY, ...policy, schemaVersion: 1 };
  next.defaultMode = normalizeMode(next.defaultMode);
  const errors = validatePolicy(next);
  if (errors.length) {
    const err = new Error(`Invalid runtime policy: ${errors.join('; ')}`);
    err.code = 'INVALID_RUNTIME_POLICY';
    err.details = errors;
    throw err;
  }
  atomicWriteJson(policyPath(rootDir), next);
  return next;
}

function updatePolicy(rootDir, changes) {
  return writePolicy(rootDir, { ...loadPolicy(rootDir), ...changes });
}

function assertModeAllowed(rootDir, mode) {
  const normalized = normalizeMode(mode);
  const policy = loadPolicy(rootDir);
  if (normalized === RUN_MODES.UNATTENDED && !policy.allowUnattended) {
    const err = new Error('UNATTENDED mode is disabled by runtime policy; a human must explicitly enable allowUnattended');
    err.code = 'UNATTENDED_DISABLED';
    throw err;
  }
  return policy;
}

module.exports = {
  DEFAULT_POLICY,
  policyPath,
  normalizeMode,
  validatePolicy,
  loadPolicy,
  writePolicy,
  updatePolicy,
  assertModeAllowed
};
