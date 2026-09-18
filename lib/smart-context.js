'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { atomicWriteJson, getCurrentRun, loadRun, runsDir } = require('./run-state.js');
const { assertBudgetAvailable } = require('./budget.js');
const { ensurePrivateRuntimeIgnores } = require('./runtime-files.js');
const {
  CONTEXT_PROFILE_LIMITS,
  estimateTokens,
  isSensitivePath,
  redactSecrets,
  resolveSafeRepoFile
} = require('./safe-context.js');
const { loadPolicy, normalizeReviewProfile } = require('./runtime-policy.js');

const DIFF_PACK_LIMITS = Object.freeze({
  lean: Object.freeze({ maxFiles: 20, maxHunksPerFile: 8, maxHunkBytes: 4_000, maxTotalBytes: 32_000 }),
  standard: Object.freeze({ maxFiles: 35, maxHunksPerFile: 12, maxHunkBytes: 8_000, maxTotalBytes: 64_000 }),
  thorough: Object.freeze({ maxFiles: 60, maxHunksPerFile: 20, maxHunkBytes: 12_000, maxTotalBytes: 128_000 })
});

function smartContextError(message, code = 'SMART_CONTEXT_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function contextRoot(rootDir) {
  return path.join(rootDir, '.ai-engineering-loop', 'context');
}

function summaryCacheDir(rootDir) {
  return path.join(contextRoot(rootDir), 'files');
}

function git(rootDir, args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function listTrackedFiles(rootDir) {
  return git(rootDir, ['ls-files'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((relativePath) => !isSensitivePath(relativePath));
}

function languageFor(relativePath) {
  const extension = path.extname(relativePath).replace(/^\./, '').toLowerCase();
  return extension || 'text';
}

function extractSymbols(relativePath, text) {
  const symbols = [];
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\bclass\s+([A-Za-z_$][\w$]*)\b/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
    /\bexports\.([A-Za-z_$][\w$]*)\s*=/g,
    /\bmodule\.exports\.([A-Za-z_$][\w$]*)\s*=/g,
    /^#{1,6}\s+(.+)$/gm
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const symbol = String(match[1] || '').trim();
      if (symbol && !symbols.includes(symbol)) symbols.push(symbol);
      if (symbols.length >= 20) return symbols;
    }
  }
  if (symbols.length === 0 && ['json', 'md', 'txt'].includes(languageFor(relativePath))) {
    const firstLine = text.split('\n').find((line) => line.trim());
    if (firstLine) symbols.push(firstLine.trim().slice(0, 80));
  }
  return symbols;
}

function summarizeFile(rootDir, relativePath) {
  const safe = resolveSafeRepoFile(rootDir, relativePath);
  const raw = fs.readFileSync(safe.absolute);
  const sourceSha = sha256(raw);
  const cached = readCachedSummary(rootDir, sourceSha);
  if (cached) return { ...cached, path: safe.relative, cacheHit: true };
  if (raw.includes(0)) {
    const summary = {
      path: safe.relative,
      binary: true,
      sourceSha256: sourceSha,
      sourceBytes: raw.length,
      language: languageFor(safe.relative),
      lines: null,
      symbols: []
    };
    writeCachedSummary(rootDir, summary);
    return { ...summary, cacheHit: false };
  }
  const text = raw.toString('utf8');
  const summary = {
    path: safe.relative,
    binary: false,
    sourceSha256: sourceSha,
    sourceBytes: raw.length,
    language: languageFor(safe.relative),
    lines: text.length === 0 ? 0 : text.split('\n').length,
    symbols: extractSymbols(safe.relative, text)
  };
  writeCachedSummary(rootDir, summary);
  return { ...summary, cacheHit: false };
}

function readCachedSummary(rootDir, sourceSha) {
  const filePath = path.join(summaryCacheDir(rootDir), `${sourceSha}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (cached.sourceSha256 !== sourceSha) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedSummary(rootDir, summary) {
  const filePath = path.join(summaryCacheDir(rootDir), `${summary.sourceSha256}.json`);
  atomicWriteJson(filePath, {
    path: summary.path,
    binary: summary.binary,
    sourceSha256: summary.sourceSha256,
    sourceBytes: summary.sourceBytes,
    language: summary.language,
    lines: summary.lines,
    symbols: summary.symbols
  });
}

function buildContextIndex(rootDir, { files } = {}) {
  ensurePrivateRuntimeIgnores(rootDir);
  const candidates = (files && files.length ? files : listTrackedFiles(rootDir))
    .map((file) => String(file).trim())
    .filter(Boolean);
  const summaries = [];
  const cache = { hits: 0, misses: 0 };
  for (const candidate of [...new Set(candidates)]) {
    try {
      const summary = summarizeFile(rootDir, candidate);
      if (summary.cacheHit) cache.hits += 1;
      else cache.misses += 1;
      const { cacheHit: _cacheHit, ...publicSummary } = summary;
      summaries.push(publicSummary);
    } catch (cause) {
      if (cause.code === 'CONTEXT_FILE_MISSING') continue;
      throw cause;
    }
  }
  const index = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    cache,
    files: summaries.sort((left, right) => left.path.localeCompare(right.path))
  };
  const indexPath = path.join(contextRoot(rootDir), 'index.json');
  atomicWriteJson(indexPath, index);
  return {
    index,
    path: path.relative(rootDir, indexPath).split(path.sep).join('/')
  };
}

function parseDiff(diff) {
  const files = [];
  let currentFile = null;
  let currentHunk = null;
  for (const line of String(diff || '').split('\n')) {
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      currentFile = {
        path: fileMatch[2],
        oldPath: fileMatch[1],
        hunks: []
      };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith('@@ ')) {
      currentHunk = { header: line, lines: [line] };
      currentFile.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk) currentHunk.lines.push(line);
  }
  return files.filter((file) => file.hunks.length > 0);
}

function compactFinding(finding) {
  return {
    id: finding.id,
    axis: finding.axis,
    severity: finding.severity,
    validity: finding.validity,
    disposition: finding.disposition,
    location: finding.location,
    acceptanceCriteria: finding.acceptanceCriteria
  };
}

function pathFromFindingLocation(location) {
  const value = String(location || '').split('#')[0].trim();
  return value || null;
}

function unresolvedFindings(rootDir, runId) {
  const filePath = path.join(runsDir(rootDir), runId, 'findings.json');
  if (!fs.existsSync(filePath)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw smartContextError(`Unable to read findings.json: ${cause.message}`, 'INVALID_FINDINGS');
  }
  return (parsed.findings || [])
    .filter((finding) => finding.validity === 'VALID')
    .filter((finding) => ['BLOCKER', 'HIGH'].includes(finding.severity) || finding.disposition === 'STRONG')
    .map(compactFinding)
    .slice(0, 20);
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw smartContextError('No current run. Pass --run <id>.', 'NO_CURRENT_RUN');
  return current;
}

function summarizeChangedFile(rootDir, relativePath) {
  try {
    return summarizeFile(rootDir, relativePath);
  } catch (cause) {
    if (cause.code === 'CONTEXT_FILE_MISSING') {
      return {
        path: relativePath,
        deleted: true,
        binary: false,
        sourceSha256: null,
        sourceBytes: 0,
        language: languageFor(relativePath),
        lines: null,
        symbols: []
      };
    }
    throw cause;
  }
}

function boundedHunks(file, limits, remainingBytes) {
  const hunks = [];
  let includedBytes = 0;
  let truncated = file.hunks.length > limits.maxHunksPerFile;
  for (const hunk of file.hunks.slice(0, limits.maxHunksPerFile)) {
    if (remainingBytes - includedBytes <= 0) {
      truncated = true;
      break;
    }
    const rawContent = hunk.lines.join('\n');
    const redacted = redactSecrets(rawContent);
    const allowed = Math.min(Buffer.byteLength(redacted.text), limits.maxHunkBytes, remainingBytes - includedBytes);
    const content = Buffer.from(redacted.text).subarray(0, allowed).toString('utf8');
    if (allowed < Buffer.byteLength(redacted.text)) truncated = true;
    includedBytes += allowed;
    hunks.push({
      header: hunk.header,
      content,
      redactions: redacted.categories,
      truncated: allowed < Buffer.byteLength(redacted.text)
    });
  }
  return { hunks, includedBytes, truncated };
}

function createDiffHunkPack(rootDir, { runId, base = 'HEAD', profile } = {}) {
  const run = resolveRun(rootDir, runId);
  const policy = loadPolicy(rootDir);
  const reviewProfile = normalizeReviewProfile(profile || policy.reviewProfile);
  const limits = DIFF_PACK_LIMITS[reviewProfile];
  const contextLimits = CONTEXT_PROFILE_LIMITS[reviewProfile]['devil-advocate'];
  const diff = git(rootDir, ['diff', '--no-ext-diff', '--unified=3', base, '--']);
  const allParsedFiles = parseDiff(diff).filter((file) => !isSensitivePath(file.path));
  const parsedFiles = allParsedFiles.slice(0, limits.maxFiles);
  const totalFilesTruncated = allParsedFiles.length > parsedFiles.length;
  const unresolved = unresolvedFindings(rootDir, run.runId);
  const changedPaths = allParsedFiles.map((file) => file.path);
  const focusPaths = [...new Set(unresolved
    .map((finding) => pathFromFindingLocation(finding.location))
    .filter((location) => location && changedPaths.includes(location)))];
  const files = [];
  let totalBytes = 0;
  let estimatedTokens = 0;
  for (const file of parsedFiles) {
    const remaining = limits.maxTotalBytes - totalBytes;
    if (remaining <= 0) break;
    const bounded = boundedHunks(file, limits, remaining);
    totalBytes += bounded.includedBytes;
    estimatedTokens += estimateTokens(bounded.hunks.map((hunk) => hunk.content).join('\n'));
    files.push({
      path: file.path,
      oldPath: file.oldPath === file.path ? null : file.oldPath,
      summary: summarizeChangedFile(rootDir, file.path),
      includedBytes: bounded.includedBytes,
      truncated: bounded.truncated,
      hunks: bounded.hunks
    });
  }
  if (estimatedTokens > contextLimits.maxEstimatedTokens) {
    throw smartContextError(`${reviewProfile} diff hunk pack exceeds devil-advocate token budget`, 'DIFF_PACK_TOKEN_LIMIT');
  }
  assertBudgetAvailable(rootDir, { runId: run.runId, estimatedTokens });
  const pack = {
    schemaVersion: 1,
    runId: run.runId,
    reviewProfile,
    base,
    createdAt: new Date().toISOString(),
    mode: 'diff-hunks',
    limits,
    totalBytes,
    estimatedTokens,
    truncated: totalFilesTruncated || files.some((file) => file.truncated),
    reviewDelta: {
      previousDiffHash: run.artifacts?.diff?.sha256 || null,
      currentDiffHash: sha256(diff),
      changedPaths,
      unresolvedFindingIds: unresolved.map((finding) => finding.id),
      focusPaths
    },
    unresolvedFindings: unresolved,
    files
  };
  const packPath = path.join(runsDir(rootDir), run.runId, 'context', 'diff-hunks.json');
  atomicWriteJson(packPath, pack);
  return {
    pack,
    path: path.relative(rootDir, packPath).split(path.sep).join('/')
  };
}

function smartContextSummary(result) {
  if (result.pack) {
    return {
      schemaVersion: result.pack.schemaVersion,
      runId: result.pack.runId,
      reviewProfile: result.pack.reviewProfile,
      path: result.path,
      files: result.pack.files.length,
      totalBytes: result.pack.totalBytes,
      estimatedTokens: result.pack.estimatedTokens,
      truncated: result.pack.truncated,
      unresolvedFindings: result.pack.unresolvedFindings.length
    };
  }
  return {
    schemaVersion: result.index.schemaVersion,
    path: result.path,
    files: result.index.files.length
  };
}

module.exports = {
  DIFF_PACK_LIMITS,
  buildContextIndex,
  createDiffHunkPack,
  parseDiff,
  smartContextSummary
};
