'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { acStatuses } = require('../lib/ac-status.js');

const goal = { acceptanceCriteria: [
  { id: 'AC-1', verify: { command: 'npm test -- list' } },
  { id: 'AC-2', verify: { command: 'npm run e2e' } },
  { id: 'AC-3', verify: { command: 'npm run lint' } },
  { id: 'AC-4' }
] };

test('C-07 AC status is derived from recorded commands, never set by hand', () => {
  const records = [
    { command: 'npm  test -- list', exitCode: 0, timeoutStatus: 'COMPLETED' },
    { command: 'npm run e2e', exitCode: 1, timeoutStatus: 'COMPLETED' }
  ];
  assert.deepStrictEqual(acStatuses(goal, records).map((ac) => [ac.id, ac.status]), [
    ['AC-1', 'proven'], ['AC-2', 'failed'], ['AC-3', 'pending'], ['AC-4', 'unbound']
  ]);
  const timedOut = [{ command: 'npm test -- list', exitCode: 0, timeoutStatus: 'TIMED_OUT' }];
  assert.strictEqual(acStatuses(goal, timedOut)[0].status, 'failed');
});
