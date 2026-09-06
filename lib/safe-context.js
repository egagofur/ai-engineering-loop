'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { atomicWriteJson, getCurrentRun, loadRun, runsDir } = require('./run-state.js');
const { assertBudgetAvailable } = require('./budget.js');

const STAGE_LIMITS = Object.freeze({
  maker: Object.freeze({ maxFiles: 12, maxFileBytes: 32_000, maxTotalBytes: 96_000, maxEstimatedTokens: 24_000 }),
  'devil-advocate': Object.freeze({ maxFiles: 8, maxFileBytes: 16_000, maxTotalBytes: 64_000, maxEstimatedTokens: 16_000 }),
  judge: Object.freeze({ maxFiles: 3, maxFileBytes: 12_000, maxTotalBytes: 32_000, maxEstimatedTokens: 8_000 })
});

const SENSITIVE_NAMES = [
  /^\.env(?:\.|$)/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^credentials(?:\.json)?$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /\.(?:pem|key|p12|pfx|jks)$/i
];

function contextError(message, code = 'UNSAFE_CONTEXT') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isSensitivePath(relativePath) {
  const segments = relativePath.split(/[\\/]/);
  if (segments.includes('.git') || segments.includes('node_modules')) return true;
  return segments.some((segment) => SENSITIVE_NAMES.some((pattern) => pattern.test(segment)));
}

function resolveSafeRepoFile(rootDir, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw contextError(`Context path must be repository-relative: ${relativePath || '(empty)'}`);
  }
  const root = fs.realpathSync(rootDir);
  const requested = path.resolve(root, relativePath);
  if (!inside(root, requested)) throw contextError(`Context path escapes the repository: ${relativePath}`);
  const normalized = path.relative(root, requested);
  if (isSensitivePath(normalized)) throw contextError(`Sensitive context path is blocked: ${relativePath}`);

  let real;
  try {
    real = fs.realpathSync(requested);
  } catch (cause) {
    throw contextError(`Context file is unavailable: ${relativePath} (${cause.message})`, 'CONTEXT_FILE_MISSING');
  }
  if (!inside(root, real)) throw contextError(`Context symlink escapes the repository: ${relativePath}`);
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw contextError(`Context path is not a file: ${relativePath}`);
  return { absolute: real, relative: path.relative(root, real).split(path.sep).join('/') };
}

function redactSecrets(input) {
  let text = String(input || '');
  const categories = new Set();
  const replace = (pattern, category, replacement) => {
    text = text.replace(pattern, (...args) => {
      categories.add(category);
      return typeof replacement === 'function' ? replacement(...args) : replacement;
    });
  };

  replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    'private-key',
    '[REDACTED PRIVATE KEY]'
  );
  replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'bearer-token', 'Bearer [REDACTED]');
  replace(/\bgithub_pat_[A-Za-z0-9_]{12,}\b/g, 'github-token', '[REDACTED GITHUB TOKEN]');
  replace(/\bgh[pousr]_[A-Za-z0-9]{12,}\b/g, 'github-token', '[REDACTED GITHUB TOKEN]');
  replace(/\bAKIA[A-Z0-9]{16}\b/g, 'aws-access-key', '[REDACTED AWS ACCESS KEY]');
  replace(/\bsk-(?:live-|test-)?[A-Za-z0-9_-]{8,}\b/g, 'api-token', '[REDACTED API TOKEN]');
  replace(
    /(\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|authorization)\b\s*[:=]\s*["']?)([^"'\s,;]+)/gi,
    'key-value-secret',
    (_match, prefix) => `${prefix}[REDACTED]`
  );

  return { text, categories: [...categories].sort() };
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw contextError('No current run. Start one before building context.', 'NO_CURRENT_RUN');
  return current;
}

function createContextPack(rootDir, { runId, stage, files } = {}) {
  const limits = STAGE_LIMITS[stage];
  if (!limits) {
    throw contextError(`Unknown context stage: ${stage}. Use ${Object.keys(STAGE_LIMITS).join('|')}`, 'UNKNOWN_CONTEXT_STAGE');
  }
  const run = resolveRun(rootDir, runId);
  assertBudgetAvailable(rootDir, { runId: run.runId });
  const uniqueFiles = [...new Set((files || []).map((file) => String(file).trim()).filter(Boolean))];
  if (uniqueFiles.length === 0) throw contextError('At least one context file is required', 'EMPTY_CONTEXT');
  if (uniqueFiles.length > limits.maxFiles) {
    throw contextError(`${stage} context allows at most ${limits.maxFiles} files`, 'CONTEXT_FILE_LIMIT');
  }

  const entries = [];
  let totalBytes = 0;
  let estimatedTokens = 0;
  for (const requested of uniqueFiles) {
    const safe = resolveSafeRepoFile(rootDir, requested);
    const raw = fs.readFileSync(safe.absolute);
    if (raw.includes(0)) throw contextError(`Binary context is blocked: ${requested}`, 'BINARY_CONTEXT');

    const remaining = limits.maxTotalBytes - totalBytes;
    if (remaining <= 0) throw contextError(`${stage} context exceeds its byte budget`, 'CONTEXT_BYTE_LIMIT');
    const allowedBytes = Math.min(raw.length, limits.maxFileBytes, remaining);
    const source = raw.subarray(0, allowedBytes).toString('utf8');
    const redacted = redactSecrets(source);
    const tokens = estimateTokens(redacted.text);
    if (estimatedTokens + tokens > limits.maxEstimatedTokens) {
      throw contextError(`${stage} context exceeds its estimated token budget`, 'CONTEXT_TOKEN_LIMIT');
    }

    totalBytes += allowedBytes;
    estimatedTokens += tokens;
    entries.push({
      path: safe.relative,
      sourceSha256: sha256(raw),
      sourceBytes: raw.length,
      includedBytes: allowedBytes,
      estimatedTokens: tokens,
      truncated: allowedBytes < raw.length,
      redactions: redacted.categories,
      content: redacted.text
    });
  }
  assertBudgetAvailable(rootDir, { runId: run.runId, estimatedTokens });

  const pack = {
    schemaVersion: 1,
    runId: run.runId,
    stage,
    createdAt: new Date().toISOString(),
    transcriptInherited: false,
    limits,
    totalBytes,
    estimatedTokens,
    entries
  };
  const packPath = path.join(runsDir(rootDir), run.runId, 'context', `${stage}.json`);
  atomicWriteJson(packPath, pack);
  return {
    pack,
    path: path.relative(rootDir, packPath).split(path.sep).join('/')
  };
}

function contextPackSummary(result) {
  return {
    schemaVersion: result.pack.schemaVersion,
    runId: result.pack.runId,
    stage: result.pack.stage,
    path: result.path,
    files: result.pack.entries.length,
    totalBytes: result.pack.totalBytes,
    estimatedTokens: result.pack.estimatedTokens,
    redactions: result.pack.entries.reduce((sum, entry) => sum + entry.redactions.length, 0),
    truncatedFiles: result.pack.entries.filter((entry) => entry.truncated).length
  };
}

module.exports = {
  STAGE_LIMITS,
  isSensitivePath,
  resolveSafeRepoFile,
  redactSecrets,
  estimateTokens,
  createContextPack,
  contextPackSummary
};
