'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runInterventions, summarizeInterventions } = require('../lib/interventions.js');

function runDir({ answers = 0, escalated = false, outcomes = 0, proofs = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-interventions-'));
  fs.writeFileSync(path.join(dir, 'interactions.jsonl'), [
    ...Array.from({ length: answers }, () => JSON.stringify({ type: 'ANSWER' })),
    JSON.stringify({ type: 'QUESTION' })
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ state: escalated ? 'ESCALATED' : 'DELIVERED', history: [] }));
  if (outcomes) fs.writeFileSync(path.join(dir, 'outcomes.jsonl'), Array.from({ length: outcomes }, () => '{}').join('\n'));
  if (proofs.length) fs.writeFileSync(path.join(dir, 'proofs.json'), JSON.stringify({ proofs: proofs.map((status) => ({ status })) }));
  return dir;
}

test('C-36 interventions count answered questions, escalations and later problems per Run, plus proof outcomes', () => {
  const a = runInterventions(runDir({ answers: 2, proofs: ['reproduced', 'not_reproduced'] }));
  const b = runInterventions(runDir({ answers: 1, escalated: true, outcomes: 1, proofs: ['reproduced'] }));
  assert.deepStrictEqual([a.total, b.total], [2, 3]);
  const sum = summarizeInterventions([a, b]);
  assert.strictEqual(sum.perRun, 2.5);
  assert.deepStrictEqual(sum.proofs, { reproduced: 2, not_reproduced: 1, refused: 0, timed_out: 0 });
  assert.strictEqual(sum.reproducedRate, 0.667);
  assert.strictEqual(summarizeInterventions([]).perRun, null);
});
