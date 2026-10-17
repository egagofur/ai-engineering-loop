'use strict';

// Proof-carrying PR receipt (#70). `deliver` writes RUN_DIR/receipt.json:
// the frozen Goal and its hash, per-AC evidence, the DA/Judge result, base and
// head SHA, the sha256 of every referenced artifact, and an overall digest.
// `verify-receipt` re-checks all of it, so a reviewer (or CI) can trust the
// PR body without re-reading the Run.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getCurrentRun, loadRun, runsDir } = require('./run-state.js');
const { canonicalJson, sha256 } = require('./recipe.js');
const { parseClaimedVsReality } = require('./claimed-vs-reality.js');
const { redactHomePaths, redactSecrets } = require('./safe-context.js');
const { isBlockingFinding } = require('./orchestration.js');

const RECEIPT_FILE = 'receipt.json';
const RECEIPT_MARKDOWN_FILE = 'receipt.md';
const CLAIMED_VS_REALITY = '.ai-engineering-loop/tasks/claimed-vs-reality.md';
const RUN_ARTIFACTS = Object.freeze([
  ['goalContract', 'goal-contract.json', true],
  ['diff', 'diff.patch', true],
  ['verification', 'verification.json', true],
  ['findings', 'findings.json', true],
  ['verdict', 'verdict.json', true],
  ['impactMap', 'impact-map.json', false],
  ['impactDrift', 'impact-drift.json', false],
  ['guardEvents', 'guard-events.json', false]
]);
const MAX_TEXT = 500;

function receiptError(message, code = 'RECEIPT_FAILED', details = []) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw receiptError('No current Run. Pass --run <id>.', 'NO_CURRENT_RUN');
  return current;
}

function hashBytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function repoRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

// Receipts leave the machine: no secrets and no local absolute paths.
function safeText(value) {
  return redactHomePaths(redactSecrets(String(value ?? '')).text)
    .replace(/(?:^|\s)\/(?:tmp|var|private|Users|home)\/\S*/g, ' [REDACTED PATH]')
    .trim()
    .slice(0, MAX_TEXT);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw receiptError(`${label} is missing or invalid: ${cause.message}`, 'RECEIPT_INPUT_MISSING');
  }
}

function gitHead(rootDir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function validateLink(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    parsed = null;
  }
  if (!parsed || !['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw receiptError(`Evidence links must be hosted http(s) URLs without credentials: ${safeText(url)}`, 'INVALID_EVIDENCE_LINK');
  }
  return parsed.toString();
}

// `--evidence AC-1=https://ci.example/run/1` (repeatable).
function parseEvidenceLinks(values = []) {
  const links = {};
  for (const value of values) {
    const match = String(value).match(/^(AC-\d+)=(.+)$/);
    if (!match) throw receiptError(`--evidence must be AC-N=<https-url>, received ${safeText(value)}`, 'INVALID_EVIDENCE_LINK');
    (links[match[1]] ||= []).push(validateLink(match[2]));
  }
  return links;
}

function artifactEntries(rootDir, run) {
  const directory = path.join(runsDir(rootDir), run.runId);
  const entries = [];
  for (const [name, file, required] of RUN_ARTIFACTS) {
    const filePath = path.join(directory, file);
    if (!fs.existsSync(filePath)) {
      if (required) throw receiptError(`Receipt needs ${file}; finish the gates first`, 'RECEIPT_INPUT_MISSING');
      continue;
    }
    entries.push({ name, path: repoRelative(rootDir, filePath), sha256: hashBytes(fs.readFileSync(filePath)) });
  }
  const claimed = path.join(rootDir, CLAIMED_VS_REALITY);
  if (fs.existsSync(claimed)) {
    entries.push({ name: 'claimedVsReality', path: CLAIMED_VS_REALITY, sha256: hashBytes(fs.readFileSync(claimed)) });
  }
  return entries;
}

function commandEvidence(command) {
  return {
    type: 'command',
    command: safeText(command.command),
    exitCode: command.exitCode,
    timeoutStatus: command.timeoutStatus,
    outputSha256: sha256(`${command.stdout || ''}\n${command.stderr || ''}`),
    passed: command.exitCode === 0 && command.timeoutStatus === 'COMPLETED'
  };
}

// Optional coverage numbers from verification.json (e.g. { lines: 91.2,
// linesDelta: 0.4 }); only finite numbers are kept, never paths or text.
function coverageSummary(coverage) {
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) return null;
  const numbers = Object.entries(coverage).filter(([key, value]) => /^[A-Za-z0-9_-]{1,40}$/.test(key) && Number.isFinite(value));
  return numbers.length ? Object.fromEntries(numbers.sort(([a], [b]) => a.localeCompare(b))) : null;
}

function criterionEntry(criterion, { commands, claims, links }) {
  const claim = claims.find((row) => row.ac === criterion.id);
  const evidence = [];
  const missing = [];
  if (claim && String(claim.reality || '').trim()) {
    evidence.push({ type: 'claim', claimed: safeText(claim.claimed), reality: safeText(claim.reality) });
  } else {
    missing.push('no claimed-vs-reality row with a Reality cell');
  }
  if (!commands.length) missing.push('no recorded verification command');
  else if (commands.some((item) => !item.passed)) missing.push('a verification command did not pass');
  evidence.push(...commands);
  for (const url of links[criterion.id] || []) evidence.push({ type: 'link', url });
  return {
    id: criterion.id,
    statement: safeText(criterion.statement),
    evidenceRequired: safeText(criterion.evidenceRequired),
    status: missing.length ? 'MISSING' : 'PASS',
    ...(missing.length ? { missing } : {}),
    evidence
  };
}

function receiptDigest(receipt) {
  const { digest: _digest, ...body } = receipt;
  return sha256(canonicalJson(body));
}

function buildReceipt(rootDir, { runId, host, model, head, evidenceLinks = [], aelVersion, now = new Date() } = {}) {
  const run = resolveRun(rootDir, runId);
  const directory = path.join(runsDir(rootDir), run.runId);
  const artifacts = artifactEntries(rootDir, run);
  const goalFile = path.join(directory, 'goal-contract.json');
  const goal = readJson(goalFile, 'goal-contract.json');
  const verification = readJson(path.join(directory, 'verification.json'), 'verification.json');
  const findings = readJson(path.join(directory, 'findings.json'), 'findings.json');
  const verdict = readJson(path.join(directory, 'verdict.json'), 'verdict.json');
  const claimedFile = path.join(rootDir, CLAIMED_VS_REALITY);
  const claims = fs.existsSync(claimedFile) ? parseClaimedVsReality(fs.readFileSync(claimedFile, 'utf8')).rows : [];
  const commands = (verification.commands || []).map(commandEvidence);
  const links = parseEvidenceLinks(evidenceLinks);
  const unknownLinks = Object.keys(links).filter((id) => !(goal.acceptanceCriteria || []).some((item) => item.id === id));
  if (unknownLinks.length) throw receiptError(`--evidence names unknown AC: ${unknownLinks.join(', ')}`, 'INVALID_EVIDENCE_LINK');
  const ledger = Array.isArray(findings.findings) ? findings.findings : [];
  const drift = artifacts.some((item) => item.name === 'impactDrift')
    ? readJson(path.join(directory, 'impact-drift.json'), 'impact-drift.json')
    : null;
  const guardEvents = artifacts.some((item) => item.name === 'guardEvents')
    ? (readJson(path.join(directory, 'guard-events.json'), 'guard-events.json').events || [])
    : [];
  const bySeverity = {};
  for (const finding of ledger) bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
  const receipt = {
    schemaVersion: 1,
    runId: run.runId,
    generatedAt: now.toISOString(),
    aelVersion: aelVersion || null,
    host: { id: safeText(host || 'unspecified'), model: model ? safeText(model) : (verdict.model ? safeText(verdict.model) : null) },
    base: { sha: run.startedRevision || null },
    head: { sha: head || gitHead(rootDir) },
    goal: {
      path: repoRelative(rootDir, goalFile),
      sha256: hashBytes(fs.readFileSync(goalFile)),
      contentHash: sha256(goal),
      version: run.goal?.version || 1,
      objective: safeText(goal.objective)
    },
    acceptanceCriteria: (goal.acceptanceCriteria || []).map((criterion) => criterionEntry(criterion, { commands, claims, links })),
    verification: {
      diffHash: verification.diffHash,
      gitRevision: verification.gitRevision,
      commands,
      coverage: coverageSummary(verification.coverage)
    },
    review: {
      findings: {
        total: ledger.length,
        valid: ledger.filter((item) => item.validity === 'VALID').length,
        blocking: ledger.filter(isBlockingFinding).length,
        bySeverity
      },
      verdict: {
        verdict: verdict.verdict,
        modelTier: verdict.modelTier || null,
        decidedBy: safeText(verdict.decidedBy || 'judge'),
        reason: safeText(verdict.reason)
      }
    },
    impact: drift ? { mapStatus: drift.mapStatus, outOfMap: (drift.outOfMap || []).map(safeText) } : null,
    guard: {
      warn: guardEvents.filter((event) => event.decision === 'warn').length,
      block: guardEvents.filter((event) => event.decision === 'block').length
    },
    artifacts
  };
  receipt.digest = receiptDigest(receipt);
  return receipt;
}

function markdownCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function short(sha, length = 12) {
  return sha ? String(sha).slice(0, length) : 'unknown';
}

function renderReceiptMarkdown(receipt) {
  const lines = [
    '## Receipt',
    '',
    `Run \`${receipt.runId}\` · Goal v${receipt.goal.version} \`${short(receipt.goal.contentHash)}\` · base \`${short(receipt.base.sha, 7)}\` → head \`${short(receipt.head.sha, 7)}\` · digest \`${short(receipt.digest)}\``,
    ''
  ];
  for (const criterion of receipt.acceptanceCriteria) {
    const parts = [];
    for (const item of criterion.evidence) {
      if (item.type === 'command') parts.push(`\`${markdownCell(item.command)}\` exit ${item.exitCode}`);
      if (item.type === 'claim') parts.push(`reality: ${markdownCell(item.reality)}`);
      if (item.type === 'link') parts.push(`[evidence](${item.url})`);
    }
    const missing = criterion.missing ? ` — **missing:** ${criterion.missing.join('; ')}` : '';
    lines.push(`- ${criterion.status === 'PASS' ? '✅' : '❌'} **${criterion.id}** ${markdownCell(criterion.statement)}${parts.length ? ` — ${parts.join(', ')}` : ''}${missing}`);
  }
  const { findings, verdict } = receipt.review;
  lines.push('');
  lines.push(`Judge: **${verdict.verdict}**${verdict.modelTier ? ` (${verdict.modelTier})` : ''} · Findings: ${findings.total} (${findings.valid} valid, ${findings.blocking} blocking)` +
    `${receipt.impact ? ` · Impact map: ${receipt.impact.mapStatus}, ${receipt.impact.outOfMap.length} file(s) outside` : ''}` +
    ` · Guard: ${receipt.guard.block} blocked, ${receipt.guard.warn} warned`);
  lines.push('');
  lines.push(`Check: \`npx ai-engineering-loop verify-receipt --run ${receipt.runId} --head ${short(receipt.head.sha, 40)}\``);
  return `${lines.join('\n')}\n`;
}

function writeReceipt(rootDir, options = {}) {
  const receipt = buildReceipt(rootDir, options);
  const directory = path.join(runsDir(rootDir), receipt.runId);
  const jsonPath = path.join(directory, RECEIPT_FILE);
  const markdownPath = path.join(directory, RECEIPT_MARKDOWN_FILE);
  fs.writeFileSync(jsonPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(markdownPath, renderReceiptMarkdown(receipt), { mode: 0o600 });
  return {
    receipt,
    path: repoRelative(rootDir, jsonPath),
    markdownPath: repoRelative(rootDir, markdownPath),
    missing: receipt.acceptanceCriteria.filter((item) => item.status !== 'PASS').map((item) => item.id)
  };
}

function insideRepo(rootDir, relativePath) {
  const absolute = path.resolve(rootDir, relativePath);
  const relative = path.relative(rootDir, absolute);
  if (!relativePath || path.isAbsolute(relativePath) || relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
  return absolute;
}

function verifyReceipt(rootDir, { runId, receiptPath, head } = {}) {
  let file;
  if (receiptPath) {
    file = insideRepo(rootDir, receiptPath);
    if (!file) throw receiptError('Receipt path must be repository-relative', 'UNSAFE_RECEIPT_PATH');
  } else {
    file = path.join(runsDir(rootDir), resolveRun(rootDir, runId).runId, RECEIPT_FILE);
  }
  const receipt = readJson(file, 'receipt.json');
  const problems = [];
  const fail = (code, detail) => problems.push({ code, detail });
  if (receipt.schemaVersion !== 1 || !receipt.runId) fail('RECEIPT_INVALID', 'schemaVersion 1 and runId are required');
  if (receiptDigest(receipt) !== receipt.digest) fail('RECEIPT_DIGEST_MISMATCH', 'receipt content does not match its digest');

  for (const artifact of receipt.artifacts || []) {
    const absolute = insideRepo(rootDir, artifact.path);
    if (!absolute || !fs.existsSync(absolute)) {
      fail('ARTIFACT_MISSING', `${artifact.path} is missing`);
    } else if (hashBytes(fs.readFileSync(absolute)) !== artifact.sha256) {
      fail('ARTIFACT_TAMPERED', `${artifact.path} changed after the receipt`);
    }
  }

  const goalFile = receipt.goal?.path && insideRepo(rootDir, receipt.goal.path);
  let goal = null;
  if (!goalFile || !fs.existsSync(goalFile)) {
    fail('GOAL_CHANGED', 'the frozen Goal is missing');
  } else {
    goal = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
    if (hashBytes(fs.readFileSync(goalFile)) !== receipt.goal.sha256 || sha256(goal) !== receipt.goal.contentHash) {
      fail('GOAL_CHANGED', 'the frozen Goal differs from the one in the receipt');
    }
  }
  const listed = new Map((receipt.acceptanceCriteria || []).map((item) => [item.id, item]));
  for (const criterion of goal?.acceptanceCriteria || []) {
    const entry = listed.get(criterion.id);
    if (!entry) fail('AC_NOT_IN_RECEIPT', `${criterion.id} is not in the receipt`);
    else if (entry.status !== 'PASS' || !(entry.evidence || []).length) {
      fail('AC_EVIDENCE_MISSING', `${criterion.id}: ${(entry.missing || ['no evidence']).join('; ')}`);
    }
  }
  if (receipt.review?.verdict?.verdict !== 'PASS') fail('VERDICT_NOT_PASS', `Judge verdict is ${receipt.review?.verdict?.verdict || 'missing'}`);
  if (receipt.review?.findings?.blocking) fail('BLOCKING_FINDINGS', `${receipt.review.findings.blocking} blocking finding(s)`);
  const expectedHead = head || gitHead(rootDir);
  if (!receipt.head?.sha || !expectedHead || receipt.head.sha !== expectedHead) {
    fail('HEAD_MISMATCH', `receipt head ${short(receipt.head?.sha, 7)} vs ${head ? '--head' : 'HEAD'} ${short(expectedHead, 7)}`);
  }
  return {
    ok: problems.length === 0,
    runId: receipt.runId,
    digest: receipt.digest,
    path: repoRelative(rootDir, file),
    problems
  };
}

module.exports = {
  RECEIPT_FILE,
  RECEIPT_MARKDOWN_FILE,
  buildReceipt,
  writeReceipt,
  verifyReceipt,
  renderReceiptMarkdown,
  receiptDigest,
  parseEvidenceLinks
};
