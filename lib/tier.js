'use strict';

// Task tiers (issue #33). Gates stay; only the number of stages that run
// depends on risk.
//   T0 trivial: inline AC, Maker, verification, claimed-vs-reality, delivery. 0 subagents.
//   T1 normal:  failure-table Goal, TDD, verification, lean DA, deterministic review. 1 subagent.
//   T2 risky:   full flow (grill + blast radius, DA, Judge on STRONG_MODEL). 2 subagents.
// A tier can rise automatically (never fall) when the Maker diff shows more risk.

const { extractChangedPaths, isHighRiskPath } = require('./escalation.js');

const TIERS = Object.freeze({ T0: 'T0', T1: 'T1', T2: 'T2' });
const TIER_RANK = Object.freeze({ T0: 0, T1: 1, T2: 2 });

const T0_LIMITS = Object.freeze({ maxFiles: 3, maxChangedLines: 180 });
const T2_FILE_THRESHOLD = 10;

const TRIVIAL_TASK = /\b(typo|typos|spelling|docs?|documentation|readme|changelog|comment|comments|lint|linting|format|formatting|prettier|bump|version bump|wording|copy edit)\b/i;
const RISKY_TASK = /\b(auth|authentication|authorization|login|permission|permissions|rbac|payment|payments|billing|invoice|ledger|migration|migrations|schema|database|encrypt|encryption|crypto|secret|secrets|token|credential|credentials|security|vulnerability|deploy|deployment|infra|terraform|kubernetes|k8s)\b/i;
const DOC_PATH = /(^|\/)(docs?\/.*|[^/]+\.(md|mdx|txt|rst|adoc)|LICENSE[^/]*|CHANGELOG[^/]*|\.github\/ISSUE_TEMPLATE\/.*)$/i;

function normalizeTier(value) {
  const tier = String(value || '').trim().toUpperCase();
  if (!Object.hasOwn(TIERS, tier)) {
    const err = new Error(`Invalid tier "${value}". Use T0, T1, or T2.`);
    err.code = 'INVALID_TIER';
    throw err;
  }
  return tier;
}

function maxTier(a, b) {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

function changedLineCount(diff) {
  let count = 0;
  for (const line of String(diff || '').split('\n')) {
    if ((line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---'))) count += 1;
  }
  return count;
}

// Classify from the task text and any paths already known (working tree at
// `run`, Maker diff later). Returns { tier, reasons: [{ code, detail }] }.
function classifyTier({ task = '', changedPaths = [], changedLines = null } = {}) {
  const reasons = [];
  const riskyPaths = changedPaths.filter(isHighRiskPath);
  const riskyWord = String(task).match(RISKY_TASK);
  if (riskyPaths.length) reasons.push({ code: 'HIGH_RISK_PATH', detail: riskyPaths.join(', '), tier: 'T2' });
  if (riskyWord) reasons.push({ code: 'RISKY_TASK_TEXT', detail: riskyWord[0], tier: 'T2' });
  if (changedPaths.length > T2_FILE_THRESHOLD) {
    reasons.push({ code: 'MANY_FILES', detail: `${changedPaths.length} files > ${T2_FILE_THRESHOLD}`, tier: 'T2' });
  }
  if (reasons.length) return { tier: TIERS.T2, reasons };

  const trivialWord = String(task).match(TRIVIAL_TASK);
  const docsOnly = changedPaths.length > 0 && changedPaths.every((p) => DOC_PATH.test(p));
  const small = changedPaths.length <= T0_LIMITS.maxFiles
    && (changedLines == null || changedLines <= T0_LIMITS.maxChangedLines);
  if (small && (trivialWord || docsOnly)) {
    if (trivialWord) reasons.push({ code: 'TRIVIAL_TASK_TEXT', detail: trivialWord[0], tier: 'T0' });
    if (docsOnly) reasons.push({ code: 'DOCS_ONLY_PATHS', detail: changedPaths.join(', '), tier: 'T0' });
    return { tier: TIERS.T0, reasons };
  }
  reasons.push({ code: 'DEFAULT', detail: 'normal change', tier: 'T1' });
  return { tier: TIERS.T1, reasons };
}

function initialTierState({ task, changedPaths = [], override = null, overrideReason = '', now = new Date() } = {}) {
  const auto = classifyTier({ task, changedPaths });
  if (override) {
    const tier = normalizeTier(override);
    const reason = String(overrideReason || '').trim();
    if (!reason) {
      const err = new Error('--tier requires --tier-reason "<why>" so the override is recorded.');
      err.code = 'TIER_REASON_REQUIRED';
      throw err;
    }
    return {
      current: tier,
      auto: auto.tier,
      source: 'override',
      reasons: [{ code: 'MANUAL_OVERRIDE', detail: reason.slice(0, 500), tier }, ...auto.reasons],
      history: [{ from: null, to: tier, by: 'override', reason: reason.slice(0, 500), at: now.toISOString() }]
    };
  }
  return {
    current: auto.tier,
    auto: auto.tier,
    source: 'auto',
    reasons: auto.reasons,
    history: [{ from: null, to: auto.tier, by: 'run', at: now.toISOString() }]
  };
}

// Re-assess from the gated Maker diff. Only raises the tier.
function raiseTierFromDiff(tierState, { task = '', diff = '', now = new Date() } = {}) {
  if (!tierState || !tierState.current) return null;
  const changedPaths = extractChangedPaths(diff);
  const changedLines = changedLineCount(diff);
  const assessed = classifyTier({ task: '', changedPaths, changedLines });
  let next = assessed.tier;
  // T0 must also stay inside T0 limits: a code diff that is not trivial by
  // text or docs-only paths becomes T1.
  if (tierState.current === TIERS.T0 && next === TIERS.T1) {
    const stillTrivial = classifyTier({ task, changedPaths, changedLines }).tier === TIERS.T0;
    if (stillTrivial) next = TIERS.T0;
  }
  const raised = maxTier(tierState.current, next);
  if (raised === tierState.current) return null;
  return {
    ...tierState,
    current: raised,
    reasons: [...assessed.reasons.filter((r) => r.tier === raised), ...tierState.reasons],
    history: [
      ...(tierState.history || []),
      { from: tierState.current, to: raised, by: 'maker-diff', reason: assessed.reasons.map((r) => r.code).join(',') || 'T0 limits exceeded', at: now.toISOString() }
    ]
  };
}

module.exports = {
  TIERS,
  TIER_RANK,
  T0_LIMITS,
  T2_FILE_THRESHOLD,
  normalizeTier,
  maxTier,
  changedLineCount,
  classifyTier,
  initialTierState,
  raiseTierFromDiff
};
