'use strict';

// Adapter checks shared by `doctor` and the `deliver` preflight (#63).
// Each check: { id, passed, detail, level: 'error' | 'warn' }.
// `error` = Stage 8 cannot follow this adapter; `warn` = it may fail late.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SHIPPED_TYPES, detectAdapterHints } = require('./generate-adapter.js');
const { DOT_GITLAB_HOST } = require('./adapter-detect.js');

const KNOWN_TYPES = [...SHIPPED_TYPES, 'custom'];
const CUSTOM_SPEC = '.ai-engineering-loop/adapter/delivery.md';

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

function nearestType(value) {
  const ranked = KNOWN_TYPES
    .map((type) => ({ type, distance: editDistance(String(value || '').toLowerCase(), type) }))
    .sort((a, b) => a.distance - b.distance);
  return ranked[0].distance <= 2 ? ranked[0].type : null;
}

// Which CLI must be logged in for a type, or null.
function toolFor(type) {
  if (type === 'github') return { bin: 'gh', args: ['auth', 'status'], label: 'gh auth status' };
  if (type === 'gitlab') return { bin: 'glab', args: ['auth', 'status'], label: 'glab auth status' };
  if (type === 'dot') {
    return { bin: 'glab', args: ['auth', 'status', '--hostname', DOT_GITLAB_HOST], label: `glab auth status --hostname ${DOT_GITLAB_HOST}` };
  }
  return null;
}

function defaultRun(bin, args) {
  return spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
}

function check(id, passed, detail, level = 'error') {
  return { id, passed: Boolean(passed), detail, level };
}

// projectDir: the repo being delivered. packageRoot: where adapters/ ships.
function checkAdapter(projectDir, { packageRoot = path.join(__dirname, '..'), run = defaultRun } = {}) {
  const checks = [];
  const adapterFile = path.join(projectDir, '.ai-engineering-loop', 'adapter.md');
  if (!fs.existsSync(adapterFile)) {
    checks.push(check('adapter-config', false, 'no .ai-engineering-loop/adapter.md; run init or generate-adapter', 'warn'));
    return checks;
  }
  const hints = detectAdapterHints(projectDir);
  const type = hints.existingType;
  if (!KNOWN_TYPES.includes(type)) {
    const near = nearestType(type);
    checks.push(check(
      'adapter-type',
      false,
      `unknown adapter_type "${type || '(empty)'}"; known: ${KNOWN_TYPES.join(' | ')}${near ? `; did you mean "${near}"?` : ''}`
    ));
    return checks;
  }
  checks.push(check('adapter-type', true, `adapter_type "${type}"`));

  const spec = type === 'custom' ? path.join(projectDir, CUSTOM_SPEC) : path.join(packageRoot, 'adapters', type, 'README.md');
  const specLabel = type === 'custom' ? CUSTOM_SPEC : `adapters/${type}/README.md`;
  checks.push(check('adapter-spec', fs.existsSync(spec), fs.existsSync(spec) ? `${specLabel} present` : `missing ${specLabel}`));

  const tool = toolFor(type);
  if (tool) {
    const result = run(tool.bin, tool.args);
    let detail;
    if (result.error && result.error.code === 'ENOENT') detail = `${tool.bin} not installed (needed by adapter "${type}")`;
    else if (result.error) detail = `${tool.label} failed: ${result.error.message}`;
    else if (result.status !== 0) detail = `${tool.bin} not logged in: \`${tool.label}\` exited ${result.status}`;
    else detail = `${tool.label} ok`;
    checks.push(check('adapter-auth', !result.error && result.status === 0, detail, 'warn'));
  }

  if (hints.recommended !== type && type !== 'custom') {
    checks.push(check(
      'adapter-detected',
      false,
      `configured "${type}" but the repo looks like "${hints.recommended}" (${hints.reason}); rerun generate-adapter if that is wrong`,
      'warn'
    ));
  }
  return checks;
}

module.exports = { KNOWN_TYPES, CUSTOM_SPEC, checkAdapter, nearestType, toolFor };
