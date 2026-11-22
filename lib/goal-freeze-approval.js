'use strict';

// Human freeze approval. A name in --by is not approval: an agent can pick
// any string. The human types a short challenge at their own terminal, or
// clicks Freeze in Studio. AEL_GOAL_FREEZE_OK=1 skips the terminal check for
// the test suite and the bench harness. Agents must never set it.

const crypto = require('crypto');
const fs = require('fs');

const HATCH = 'AEL_GOAL_FREEZE_OK';

function hatchOpen(env = process.env) {
  return String(env[HATCH] || '') === '1';
}

function needsHumanError(runId, message) {
  const id = runId || '<runId>';
  const error = new Error(message);
  error.code = 'GOAL_FREEZE_NEEDS_HUMAN';
  error.why = 'Only a person can freeze the Goal. A name passed as --by is not approval, and a non-interactive shell cannot grant it.';
  error.fix = `Stop. Ask the human to approve by running this in their own terminal and typing the confirmation it prints: \`goal freeze --latest --run ${id} --by "<their name>"\`. Do not type that confirmation. Do not set ${HATCH} (test suite only). A cancelled or unanswered question is not approval.`;
  return error;
}

function challengeToken(bytes = crypto.randomBytes(3)) {
  return `freeze-${Buffer.from(bytes).toString('hex')}`;
}

function readStdinLine() {
  const buf = Buffer.alloc(256);
  let text = '';
  while (text.length < 200 && !text.includes('\n')) {
    let n = 0;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (error) {
      if (error.code === 'EAGAIN' || error.code === 'EOF') break;
      throw error;
    }
    if (!n) break;
    text += buf.toString('utf8', 0, n);
  }
  return text.split(/\r?\n/, 1)[0].trim();
}

function assertGoalFreezeApproval({
  runId,
  actor,
  env = process.env,
  stdin = process.stdin,
  stderr = process.stderr,
  readLine = readStdinLine,
  token = null
} = {}) {
  if (hatchOpen(env)) return { via: 'hatch' };
  if (!stdin || stdin.isTTY !== true) {
    throw needsHumanError(runId, 'goal freeze needs a human at an interactive terminal');
  }
  const challenge = token || challengeToken();
  const name = String(actor || '').trim() || '(missing --by)';
  stderr.write([
    '',
    'Human approval is required to freeze this Goal.',
    `Approver: ${name}`,
    `Type this confirmation exactly, then press Enter: ${challenge}`,
    '> '
  ].join('\n'));
  const line = String(readLine() ?? '').trim();
  if (line !== challenge) {
    throw needsHumanError(runId, 'goal freeze confirmation did not match');
  }
  return { via: 'tty', challenge };
}

// freezeGoal refuses unless a person is present. `studioSession` is the
// Freeze click in Studio. `interactiveConfirmed` is set by the CLI only
// after the human typed the terminal challenge. Agents must not pass
// either flag, and must not set the hatch.
function assertFreezeChannel({
  runId,
  studioSession = false,
  interactiveConfirmed = false,
  env = process.env
} = {}) {
  if (studioSession || interactiveConfirmed || hatchOpen(env)) return;
  throw needsHumanError(runId, 'goal freeze needs a human at an interactive terminal');
}

module.exports = {
  HATCH,
  hatchOpen,
  needsHumanError,
  challengeToken,
  assertGoalFreezeApproval,
  assertFreezeChannel
};
