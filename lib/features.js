'use strict';

// Project feature ledger (C-15, learn-harness-engineering L07/L08): the
// cross-Run list of what the project must do. Each feature is a triple
// (behavior, verify, status). Status moves only through Run transitions:
// a frozen Goal with `featureId` makes it `active`, delivery makes it
// `passing` with the Run as evidence. `next` picks the next feature and
// reports VCR = verified / activated.

const fs = require('fs');
const path = require('path');
const { atomicWriteJson, loadRun } = require('./run-state.js');

const FEATURES_FILE = path.join('.ai-engineering-loop', 'features.json');
const STATUSES = Object.freeze(['not_started', 'active', 'blocked', 'passing']);
const FEATURES_EXAMPLE = '{"schemaVersion":1,"features":[{"id":"export-csv","title":"Export CSV","behavior":"The user can export the filtered rows.","verify":"npm test","status":"not_started","priority":1,"dependsOn":[]}]}';

function featuresFromMap(rootDir) {
  const entries = require('./feature-map.js').loadFeatureMap(rootDir);
  if (!entries.length) return null;
  return {
    schemaVersion: 1,
    source: 'feature-map.md',
    features: entries.map((entry, index) => ({
      id: entry.id,
      title: entry.where || entry.id,
      behavior: entry.how || entry.where || entry.id,
      verify: entry.driver || '',
      status: 'not_started',
      priority: index + 1,
      dependsOn: []
    }))
  };
}

function featuresPath(rootDir) {
  return path.join(rootDir, FEATURES_FILE);
}

function loadFeatures(rootDir) {
  try {
    const value = JSON.parse(fs.readFileSync(featuresPath(rootDir), 'utf8'));
    return Array.isArray(value.features) ? value : null;
  } catch {
    return null;
  }
}

function save(rootDir, document) {
  atomicWriteJson(featuresPath(rootDir), document);
}

function transition(rootDir, featureId, to, { runId, now = new Date() } = {}) {
  const document = loadFeatures(rootDir);
  const feature = document?.features.find((item) => item.id === featureId);
  if (!feature) return null;
  if (feature.status === 'passing' && to !== 'passing') return feature; // passing is final
  feature.status = to;
  feature.history = [...(feature.history || []), { to, runId, at: now.toISOString() }];
  if (to === 'passing') feature.evidence = { runId, deliveredAt: now.toISOString() };
  save(rootDir, document);
  return feature;
}

// Called by the Goal gate.
function onGoalFrozen(rootDir, run, goal) {
  if (!goal?.featureId) return null;
  const feature = loadFeatures(rootDir)?.features.find((item) => item.id === goal.featureId);
  if (!feature || feature.status === 'passing') return feature || null;
  return transition(rootDir, goal.featureId, 'active', { runId: run.runId });
}

// Called by the delivery gate.
function onDelivered(rootDir, run, goal) {
  if (!goal?.featureId) return null;
  return transition(rootDir, goal.featureId, 'passing', { runId: run.runId });
}

function vcr(document) {
  const features = document?.features || [];
  const activated = features.filter((item) => item.status !== 'not_started').length;
  const verified = features.filter((item) => item.status === 'passing').length;
  return { verified, activated, value: activated ? Math.round((verified / activated) * 1000) / 1000 : 1 };
}

function nextFeature(document) {
  const features = document?.features || [];
  const passing = new Set(features.filter((item) => item.status === 'passing').map((item) => item.id));
  return features
    .filter((item) => item.status === 'not_started' && (item.dependsOn || []).every((id) => passing.has(id)))
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))[0] || null;
}

// A `passing` feature must point at a delivered Run whose Goal names it.
function auditFeatures(rootDir, document = loadFeatures(rootDir)) {
  const problems = [];
  for (const feature of document?.features || []) {
    if (!STATUSES.includes(feature.status)) problems.push(`${feature.id}: unknown status ${feature.status}`);
    if (feature.status !== 'passing') continue;
    const runId = feature.evidence?.runId;
    let run = null;
    try {
      run = runId ? loadRun(rootDir, runId) : null;
    } catch {
      run = null;
    }
    if (!run || run.state !== 'DELIVERED') {
      problems.push(`${feature.id}: marked passing without a delivered Run as evidence. FIX: set it back to not_started and deliver it through a Run whose Goal has featureId "${feature.id}".`);
    }
  }
  return problems;
}

module.exports = { FEATURES_EXAMPLE, FEATURES_FILE, STATUSES, auditFeatures, featuresFromMap, loadFeatures, nextFeature, onDelivered, onGoalFrozen, vcr };
