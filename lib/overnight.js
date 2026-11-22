'use strict';

// Overnight contract for an UNATTENDED Run the human left. The check
// recomputes the morning packet from Run files. It does not read a note
// the agent wrote about itself.

const fs = require('fs');
const path = require('path');
const { getCurrentRun, loadRun, runsDir } = require('./run-state.js');
const { loadPolicy } = require('./runtime-policy.js');
const { runMaxIterations } = require('./no-progress.js');

const CONTRACT = Object.freeze({
  schemaVersion: 1,
  id: 'overnight-v1',
  mayDo: Object.freeze([
    'continue a Goal the human already froze',
    'edit only inside that frozen scope, in the sandbox worktree',
    'run verify, Devil\'s Advocate, and Judge inside the recipe cap and token budget',
    'record evidence under runs/<id>/'
  ]),
  mustNot: Object.freeze([
    'freeze, unfreeze, or edit the Goal',
    'deliver, approve, or merge',
    'force-push, reset --hard, or clean -fd',
    'widen scope, change verification config, or add a dependency',
    'guess a product decision, or pick an option the human has not answered'
  ]),
  stopWhen: Object.freeze([
    'GOAL_NOT_FROZEN',
    'NEEDS_HUMAN',
    'GUARD_BLOCK',
    'BUDGET',
    'VERIFY_STILL_RED',
    'JUDGE_ESCALATE',
    'JUDGED_PASS'
  ]),
  leaveForMorning: Object.freeze([
    'frozen Goal',
    'diff.patch',
    'verification.json',
    'findings.json when a review ran',
    'verdict.json or the stop reason',
    'unanswered questions'
  ])
});

const AGENT_APPROVERS = new Set([
  'agent', 'agents', 'ael', 'ael-agent', 'assistant', 'bot', 'ai', 'llm', 'model', 'system', 'auto'
]);

const PACKET_FILES = Object.freeze({
  diff: 'diff.patch',
  verification: 'verification.json',
  verdict: 'verdict.json'
});

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function fileExists(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function pendingQuestions(rootDir, runId) {
  try {
    return require('./run-interactions.js').listRunInteractions(rootDir, runId).pending
      .map((question) => ({ id: question.questionId, message: String(question.message || '').slice(0, 240) }));
  } catch {
    return [];
  }
}

function guardBlocked(runDir) {
  const parsed = readJson(path.join(runDir, 'guard-events.json'));
  const events = Array.isArray(parsed?.events) ? parsed.events : [];
  return events.some((event) => event && event.decision === 'block');
}

function verificationRed(runDir) {
  const commands = readJson(path.join(runDir, 'verification.json'))?.commands;
  if (!Array.isArray(commands) || !commands.length) return false;
  return commands.some((record) => !record || record.exitCode !== 0 || record.timeoutStatus !== 'COMPLETED');
}

function deliveryViolation(delivery) {
  const by = String(delivery?.approvedBy || delivery?.by || '').trim().toLowerCase();
  if (delivery?.humanApproved !== true || !by || AGENT_APPROVERS.has(by)) {
    return {
      id: 'DELIVERED_WITHOUT_HUMAN',
      why: 'An overnight run must not ship. Delivery waits for a person in the morning.',
      fix: 'Leave the Run at JUDGED_PASS. In the morning the human runs `deliver --approve --by <name>`.'
    };
  }
  return null;
}

function classify(run, ctx) {
  if (run.state === 'DELIVERED') {
    return {
      mayContinue: false,
      stopReason: ctx.deliveryViolation ? 'DELIVERED_WITHOUT_HUMAN' : 'MORNING_APPROVED',
      required: ctx.deliveryViolation ? [] : ['diff', 'verification', 'verdict']
    };
  }
  if (run.state === 'ESCALATED') return { mayContinue: false, stopReason: 'JUDGE_ESCALATE', required: ['verdict'] };
  if (run.state === 'CANCELLED') return { mayContinue: false, stopReason: 'CANCELLED', required: [] };
  if (run.state === 'JUDGED_PASS') return { mayContinue: false, stopReason: 'JUDGED_PASS', required: ['diff', 'verification', 'verdict'] };
  if (run.goal?.frozen !== true) return { mayContinue: false, stopReason: 'GOAL_NOT_FROZEN', required: [] };
  if (ctx.questions.length) return { mayContinue: false, stopReason: 'NEEDS_HUMAN', required: [] };
  if (ctx.killSwitch) return { mayContinue: false, stopReason: 'BUDGET', required: [] };
  if (ctx.guardBlocked) return { mayContinue: false, stopReason: 'GUARD_BLOCK', required: [] };
  if (ctx.atCap && ctx.verificationRed) return { mayContinue: false, stopReason: 'VERIFY_STILL_RED', required: [] };
  return { mayContinue: true, stopReason: null, required: [] };
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  return getCurrentRun(rootDir);
}

// `applies` is true only for UNATTENDED. Other modes return the contract and ok.
function morningReview(rootDir, { runId = null } = {}) {
  const run = resolveRun(rootDir, runId);
  if (!run) {
    return { ok: true, applies: false, contract: CONTRACT, runId: null, reason: 'NO_RUN' };
  }
  const applies = run.mode === 'UNATTENDED';
  const runDir = path.join(runsDir(rootDir), run.runId);
  const present = {
    goal: run.goal?.frozen === true,
    diff: fileExists(path.join(runDir, 'diff.patch')),
    verification: fileExists(path.join(runDir, 'verification.json')),
    findings: fileExists(path.join(runDir, 'findings.json')),
    verdict: fileExists(path.join(runDir, 'verdict.json'))
  };
  const questions = pendingQuestions(rootDir, run.runId);
  const violation = applies && run.state === 'DELIVERED' ? deliveryViolation(readJson(path.join(runDir, 'delivery.json'))) : null;
  const policy = loadPolicy(rootDir);
  const result = applies
    ? classify(run, {
      questions,
      killSwitch: policy.killSwitch === true,
      guardBlocked: guardBlocked(runDir),
      atCap: Number(run.iteration) >= runMaxIterations(rootDir, run),
      verificationRed: verificationRed(runDir),
      deliveryViolation: violation
    })
    : { mayContinue: false, stopReason: null, required: [] };
  const missing = result.required.filter((key) => !present[key]).map((key) => PACKET_FILES[key]);
  const violations = violation ? [violation] : [];
  return {
    ok: violations.length === 0 && missing.length === 0,
    applies,
    contract: CONTRACT,
    runId: run.runId,
    mode: run.mode,
    state: run.state,
    mayContinue: applies ? result.mayContinue : false,
    stopReason: result.stopReason,
    morning: { present, missing, questions },
    violations
  };
}

module.exports = {
  CONTRACT,
  morningReview
};
