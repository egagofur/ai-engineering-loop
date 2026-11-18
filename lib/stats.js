'use strict';

// `ael stats` (C-12): where the loop fails, by harness layer, and how often
// the Maker's green verification was a false victory (the Judge still found
// a VALID blocking problem). Bottlenecks come from failure records, not
// guesses (learn-harness-engineering L01/L02).

const fs = require('fs');
const path = require('path');
const { runsDir } = require('./run-state.js');
const { readIterations } = require('./no-progress.js');

function listRuns(rootDir) {
  let names = [];
  try {
    names = fs.readdirSync(runsDir(rootDir), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
  return names.sort();
}

function runTier(rootDir, runId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runsDir(rootDir), runId, 'state.json'), 'utf8')).tier?.current || null;
  } catch {
    return null;
  }
}

function computeStats(rootDir, { last = null } = {}) {
  let runs = listRuns(rootDir);
  if (Number.isInteger(last) && last > 0) runs = runs.slice(-last);
  const causes = {};
  const tiers = {};
  let judged = 0;
  let falseVictories = 0;
  const passIterations = [];
  for (const runId of runs) {
    const entries = readIterations(rootDir, runId);
    if (!entries.length) continue;
    const tier = entries.find((entry) => entry.tier)?.tier || runTier(rootDir, runId) || 'none';
    const bucket = tiers[tier] || (tiers[tier] = { runs: 0, judged: 0, falseVictories: 0 });
    bucket.runs += 1;
    for (const entry of entries) {
      judged += 1;
      bucket.judged += 1;
      if (entry.verdict !== 'PASS' && (entry.blockingCount || (entry.blockingSignatures || []).length) > 0) {
        falseVictories += 1;
        bucket.falseVictories += 1;
      }
      if (entry.verdict !== 'PASS') {
        const cause = entry.cause || 'unclassified';
        causes[cause] = (causes[cause] || 0) + 1;
      }
    }
    const pass = entries.find((entry) => entry.verdict === 'PASS');
    if (pass) passIterations.push(pass.iteration || entries.indexOf(pass) + 1);
  }
  const rate = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : 0);
  for (const bucket of Object.values(tiers)) bucket.falseVictoryRate = rate(bucket.falseVictories, bucket.judged);
  const topCauses = Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([cause, count]) => ({ cause, count }));
  // C-24: revert rate from git, token share per role from the usage ledger.
  const reverts = require('./reverts.js').detectReverts(rootDir);
  const tokensByRole = {};
  try {
    for (const entry of require('./budget.js').readAllUsage(rootDir)) {
      const role = entry.role || 'unlabeled';
      tokensByRole[role] = (tokensByRole[role] || 0) + entry.totalTokens;
    }
  } catch {
    // Unreadable ledger: report no token split rather than fail stats.
  }
  const labeled = Object.entries(tokensByRole).filter(([role]) => role !== 'unlabeled').reduce((sum, [, n]) => sum + n, 0);
  const checking = ['reviewer', 'judge', 'verification'].reduce((sum, role) => sum + (tokensByRole[role] || 0), 0);
  const { runInterventions, summarizeInterventions } = require('./interventions.js');
  const interventions = summarizeInterventions(runs.map((runId) => runInterventions(path.join(runsDir(rootDir), runId))));
  return {
    interventions,
    revertRate: reverts.rate,
    reverted: reverts.reverted,
    delivered: reverts.delivered,
    tokensByRole,
    verificationTokenShare: labeled ? rate(checking, labeled) : null,
    runs: runs.length,
    judged,
    falseVictories,
    falseVictoryRate: rate(falseVictories, judged),
    causes,
    topCauses,
    bottleneck: topCauses[0]?.cause || null,
    iterationsToPass: passIterations.length ? rate(passIterations.reduce((a, b) => a + b, 0), passIterations.length) : null,
    tiers
  };
}

function formatStats(stats) {
  const lines = [
    `Runs: ${stats.runs}, judged iterations: ${stats.judged}`,
    `False victories: ${stats.falseVictories} (${Math.round(stats.falseVictoryRate * 100)}%) - verification was green but the Judge found a VALID blocking problem`,
    `Iterations to PASS (avg): ${stats.iterationsToPass ?? 'n/a'}`,
    `Failure causes: ${Object.entries(stats.causes).map(([cause, count]) => `${cause} ${count}`).join(', ') || 'none'}`
  ];
  lines.push(`Revert rate: ${stats.reverted.length}/${stats.delivered} delivered Run(s) (${Math.round(stats.revertRate * 1000) / 10}%)${stats.reverted.length ? `: ${stats.reverted.map((item) => item.runId).join(', ')}` : ''}`);
  if (stats.verificationTokenShare != null) lines.push(`Verification token share: ${Math.round(stats.verificationTokenShare * 100)}% (reviewer + judge + verification of role-labelled usage)`);
  if (stats.interventions?.runs) {
    const i = stats.interventions;
    lines.push(`Human interventions per Run: ${i.perRun} (${i.answers} answered questions, ${i.escalations} escalations, ${i.outcomes} problems found after delivery)`);
    const ran = i.proofs.reproduced + i.proofs.not_reproduced;
    if (ran) lines.push(`Finding proofs: ${i.proofs.reproduced}/${ran} reproduced (${Math.round(i.reproducedRate * 100)}%); ${i.proofs.not_reproduced} blocking finding(s) did not reproduce and stopped blocking`);
  }
  if (stats.bottleneck) lines.push(`Bottleneck: ${stats.bottleneck}. Fix that harness layer first.`);
  for (const [tier, bucket] of Object.entries(stats.tiers)) {
    lines.push(`- ${tier}: ${bucket.runs} run(s), false-victory rate ${Math.round(bucket.falseVictoryRate * 100)}%`);
  }
  return lines.join('\n');
}

module.exports = { computeStats, formatStats };
