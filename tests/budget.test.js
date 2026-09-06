const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertBudgetAvailable,
  budgetStatus,
  readUsage,
  recordTokenUsage,
  setKillSwitch,
  usagePath
} = require('../lib/budget.js');
const { createRun } = require('../lib/run-state.js');
const { updatePolicy } = require('../lib/runtime-policy.js');

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-budget-'));
  createRun(root, { runId: 'run-001' });
  return root;
}

test('actual provider token usage is persisted privately and totaled', () => {
  const root = tempRepo();
  const now = new Date('2025-02-03T04:05:06.000Z');
  const result = recordTokenUsage(root, {
    runId: 'run-001',
    inputTokens: 120,
    outputTokens: 30,
    model: 'provider/cheap-model',
    now
  });
  assert.strictEqual(result.entry.totalTokens, 150);
  assert.strictEqual(result.status.spentThisRun, 150);
  assert.strictEqual(readUsage(root, now).length, 1);
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(usagePath(root, now)).mode & 0o777, 0o600);
  }
});

test('projected context fails closed before crossing run or daily limits', () => {
  const root = tempRepo();
  const now = new Date('2025-02-03T00:00:00.000Z');
  updatePolicy(root, { perRunTokenLimit: 100, dailyTokenLimit: 200 });
  recordTokenUsage(root, {
    runId: 'run-001',
    inputTokens: 70,
    outputTokens: 10,
    model: 'cheap-model',
    now
  });
  assert.strictEqual(budgetStatus(root, { runId: 'run-001', estimatedTokens: 20, now }).allowed, true);
  assert.throws(
    () => assertBudgetAvailable(root, { runId: 'run-001', estimatedTokens: 21, now }),
    (err) => err.code === 'BUDGET_BLOCKED' && err.details.some((reason) => reason.includes('per-run'))
  );
});

test('per-run usage carries across UTC days while the daily limit resets', () => {
  const root = tempRepo();
  updatePolicy(root, { perRunTokenLimit: 100, dailyTokenLimit: 100 });
  recordTokenUsage(root, {
    runId: 'run-001',
    inputTokens: 40,
    outputTokens: 10,
    model: 'cheap-model',
    now: new Date('2025-02-03T23:59:00.000Z')
  });
  const nextDay = budgetStatus(root, {
    runId: 'run-001',
    now: new Date('2025-02-04T00:01:00.000Z')
  });
  assert.strictEqual(nextDay.spentToday, 0);
  assert.strictEqual(nextDay.spentThisRun, 50);
});

test('kill switch pauses model boundaries but usage can still be accounted', () => {
  const root = tempRepo();
  setKillSwitch(root, true);
  assert.throws(
    () => assertBudgetAvailable(root, { runId: 'run-001' }),
    (err) => err.code === 'BUDGET_BLOCKED' && err.details.includes('kill switch is active')
  );
  assert.doesNotThrow(() => recordTokenUsage(root, {
    runId: 'run-001',
    inputTokens: 1,
    outputTokens: 1,
    model: 'cheap-model'
  }));
  setKillSwitch(root, false);
  assert.strictEqual(assertBudgetAvailable(root, { runId: 'run-001' }).allowed, true);
});

test('corrupt ledgers block instead of silently undercounting', () => {
  const root = tempRepo();
  const filePath = usagePath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{not-json}\n');
  assert.throws(
    () => budgetStatus(root, { runId: 'run-001' }),
    (err) => err.code === 'INVALID_USAGE_LEDGER'
  );
});

test('usage accounting rejects a symlink ledger', (t) => {
  const root = tempRepo();
  const filePath = usagePath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.symlinkSync(path.join(root, 'missing-ledger'), filePath, 'file');
  } catch (cause) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(cause.code)) {
      t.skip('file symlinks require Windows developer mode');
      return;
    }
    throw cause;
  }
  assert.throws(
    () => budgetStatus(root, { runId: 'run-001' }),
    (err) => err.code === 'INVALID_USAGE_LEDGER'
  );
});
