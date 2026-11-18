'use strict';

const fs = require('fs');
const path = require('path');

const lines = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

function runInterventions(runDir) {
  const answers = lines(path.join(runDir, 'interactions.jsonl')).filter((entry) => entry.type === 'ANSWER').length;
  const state = readJson(path.join(runDir, 'state.json'));
  const escalated = state?.state === 'ESCALATED' || (state?.history || []).some((entry) => entry.to === 'ESCALATED') ? 1 : 0;
  const outcomes = lines(path.join(runDir, 'outcomes.jsonl')).length;
  const proofs = { reproduced: 0, not_reproduced: 0, refused: 0, timed_out: 0 };
  for (const proof of readJson(path.join(runDir, 'proofs.json'))?.proofs || []) {
    if (Object.hasOwn(proofs, proof.status)) proofs[proof.status] += 1;
  }
  return { answers, escalated, outcomes, total: answers + escalated + outcomes, proofs };
}

function summarizeInterventions(perRun) {
  const sum = (key) => perRun.reduce((n, item) => n + item[key], 0);
  const proofs = { reproduced: 0, not_reproduced: 0, refused: 0, timed_out: 0 };
  for (const item of perRun) for (const key of Object.keys(proofs)) proofs[key] += item.proofs[key];
  const ran = proofs.reproduced + proofs.not_reproduced;
  return {
    runs: perRun.length,
    answers: sum('answers'),
    escalations: sum('escalated'),
    outcomes: sum('outcomes'),
    perRun: perRun.length ? Math.round((sum('total') / perRun.length) * 100) / 100 : null,
    proofs,
    reproducedRate: ran ? Math.round((proofs.reproduced / ran) * 1000) / 1000 : null
  };
}

module.exports = { runInterventions, summarizeInterventions };
