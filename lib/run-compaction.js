'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteJson, atomicWritePrivateFile, getCurrentRun, loadRun, runsDir } = require('./run-state.js');
const { writeVerificationSummary } = require('./verification-summary.js');
const { loadPolicy } = require('./runtime-policy.js');

function compactionError(message, code = 'RUN_COMPACTION_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw compactionError('No current run. Pass --run <id>.', 'NO_CURRENT_RUN');
  return current;
}

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function firstPresent(...values) {
  return values.find((value) => value != null && value !== '') ?? null;
}

function compactGoal(goal) {
  if (!goal) return null;
  const criteria = goal.acceptanceCriteria || goal.criteria || [];
  return {
    objective: firstPresent(goal.objective, goal.goal, goal.summary),
    revision: goal.revision || goal.draftRevision || null,
    hash: goal.hash || goal.sha256 || null,
    acceptanceCriteria: criteria.map((criterion) => ({
      id: criterion.id,
      statement: criterion.statement || criterion.description || '',
      failureCases: (criterion.failureCases || []).slice(0, 3)
    }))
  };
}

function compactFindings(findingsDocument) {
  const findings = findingsDocument?.findings || [];
  return findings
    .filter((finding) => finding.validity === 'VALID')
    .filter((finding) => !['ACCEPTABLE', 'DISMISSED', 'FIXED', 'RESOLVED'].includes(String(finding.disposition || '').toUpperCase()))
    .map((finding) => ({
      id: finding.id,
      axis: finding.axis,
      severity: finding.severity,
      disposition: finding.disposition,
      location: finding.location,
      title: finding.title || finding.topic || null
    }));
}

function markdownSummary(document) {
  const goalLines = document.goal
    ? [
        `- Objective: ${document.goal.objective || 'Not recorded'}`,
        `- Acceptance criteria: ${document.goal.acceptanceCriteria.length}`,
        `- Goal revision: ${document.goal.revision || 'n/a'}`,
        `- Goal hash: ${document.goal.hash || 'n/a'}`
      ]
    : ['- Goal: not recorded'];
  const verification = document.verification
    ? [
        `- Passed: ${document.verification.passed}`,
        `- Exit code: ${document.verification.exitCode}`,
        `- Commands: ${document.verification.commandCount}`,
        `- Tests: ${JSON.stringify(document.verification.testCounts)}`
      ]
    : ['- Verification: not summarized'];
  const findings = document.openFindings.length
    ? document.openFindings.map((finding) => `- ${finding.id} ${finding.severity || ''} ${finding.axis || ''}: ${finding.title || finding.location || 'open'}`)
    : ['- No open VALID non-accepted findings recorded'];
  return [
    `# Run Summary: ${document.runId}`,
    '',
    `Generated: ${document.generatedAt}`,
    '',
    '## State',
    '',
    `- State: ${document.state}`,
    `- Mode: ${document.mode || 'n/a'}`,
    `- Iteration: ${document.iteration}`,
    `- Review profile: ${document.reviewProfile || 'n/a'}`,
    '',
    '## Goal',
    '',
    ...goalLines,
    '',
    '## Verification',
    '',
    ...verification,
    '',
    '## Open findings',
    '',
    ...findings,
    '',
    '## Reviewer read order',
    '',
    '1. This summary',
    '2. verification-summary.json',
    '3. open-findings.json',
    '4. context/diff-hunks.json',
    '5. Full artifacts only when the summaries contradict each other'
  ].join('\n');
}

function compactRun(rootDir, { runId } = {}) {
  const run = resolveRun(rootDir, runId);
  const runDir = path.join(runsDir(rootDir), run.runId);
  const goal = readOptionalJson(path.join(runDir, 'goal-contract.json'));
  let verification = readOptionalJson(path.join(runDir, 'verification-summary.json'));
  if (!verification && fs.existsSync(path.join(runDir, 'verification.json'))) {
    verification = writeVerificationSummary(rootDir, { runId: run.runId }).summary;
  }
  const findingsDocument = readOptionalJson(path.join(runDir, 'findings.json'));
  const openFindings = compactFindings(findingsDocument);
  const summary = {
    schemaVersion: 1,
    runId: run.runId,
    generatedAt: new Date().toISOString(),
    state: run.state,
    mode: run.mode || null,
    iteration: run.iteration || 1,
    reviewProfile: loadPolicy(rootDir).reviewProfile,
    goal: compactGoal(goal),
    verification: verification ? {
      passed: verification.passed,
      exitCode: verification.exitCode,
      commandCount: verification.commandCount,
      testCounts: verification.testCounts,
      diffHash: verification.diffHash || null
    } : null,
    openFindings
  };
  const summaryPath = path.join(runDir, 'run-summary.json');
  const markdownPath = path.join(runDir, 'run-summary.md');
  const findingsPath = path.join(runDir, 'open-findings.json');
  atomicWriteJson(summaryPath, summary);
  atomicWritePrivateFile(markdownPath, `${markdownSummary(summary)}\n`);
  atomicWriteJson(findingsPath, {
    schemaVersion: 1,
    runId: run.runId,
    generatedAt: summary.generatedAt,
    findings: openFindings
  });
  return {
    summary,
    paths: {
      summary: path.relative(rootDir, summaryPath).split(path.sep).join('/'),
      markdown: path.relative(rootDir, markdownPath).split(path.sep).join('/'),
      openFindings: path.relative(rootDir, findingsPath).split(path.sep).join('/')
    }
  };
}

module.exports = {
  compactRun
};
