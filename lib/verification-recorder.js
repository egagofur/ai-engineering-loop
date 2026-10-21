'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  atomicWriteJson,
  getCurrentRun,
  getGitRevision,
  loadRun,
  runsDir,
  withFileLock
} = require('./run-state.js');
const { hashFile } = require('./gates.js');
const { redactHomePaths, redactSecrets } = require('./safe-context.js');
const { writeVerificationSummary } = require('./verification-summary.js');
const { killProcessTree, resolveSpawn } = require('./spawn-command.js');

const MAX_CAPTURE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const KILL_GRACE_MS = 2_000;
const PIPE_DRAIN_MS = 10_000;

function recorderError(message, code = 'VERIFICATION_RECORD_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw recorderError('No current Run. Pass --run <id> or start a Run first.', 'NO_CURRENT_RUN');
  return current;
}

function validateRecordingRequest({ command, args, timeoutMs, shell }) {
  if (typeof command !== 'string' || !command.trim() || command.includes('\0')) {
    throw recorderError('Provide an executable after `--`, for example `verification record -- npm test`.', 'INVALID_COMMAND');
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) {
    throw recorderError('Command arguments must be strings without NUL characters.', 'INVALID_COMMAND');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw recorderError(`Timeout must be between 1 and ${MAX_TIMEOUT_MS} milliseconds.`, 'INVALID_TIMEOUT');
  }
  if (shell && args.length > 0) {
    throw recorderError('With --shell, pass one quoted command string after `--`; shell argument arrays are intentionally unsupported.', 'INVALID_COMMAND');
  }
}

function resolveDiff(rootDir, run) {
  const artifact = run.artifacts?.diff;
  if (!artifact?.path || !artifact.sha256) {
    throw recorderError('Maker evidence is not gated yet. Run `gate maker` before recording verification.', 'MAKER_NOT_GATED');
  }
  const root = fs.realpathSync(rootDir);
  const absolute = path.resolve(root, artifact.path);
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw recorderError('The gated Maker diff path escapes the repository.', 'UNSAFE_DIFF_PATH');
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || hashFile(absolute) !== artifact.sha256) {
    throw recorderError('The gated Maker diff is missing, unsafe, or changed. Re-run the Maker gate.', 'STALE_DIFF');
  }
  return artifact.sha256;
}

function readExistingBundle(filePath, { runId, gitRevision, diffHash }) {
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: 1, runId, gitRevision, diffHash, commands: [] };
  }
  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw recorderError(`Existing verification.json is invalid: ${cause.message}`, 'INVALID_VERIFICATION');
  }
  if (
    bundle.schemaVersion !== 1
    || bundle.runId !== runId
    || bundle.gitRevision !== gitRevision
    || bundle.diffHash !== diffHash
    || !Array.isArray(bundle.commands)
  ) {
    throw recorderError(
      'Existing verification.json belongs to another Run, revision, or Maker diff. Reconcile it before recording more commands.',
      'STALE_VERIFICATION'
    );
  }
  return bundle;
}

function captureStream(stream) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  stream.on('data', (chunk) => {
    const remaining = MAX_CAPTURE_BYTES - bytes;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    const captured = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    chunks.push(captured);
    bytes += captured.length;
    if (captured.length < chunk.length) truncated = true;
  });
  return {
    value: () => Buffer.concat(chunks).toString('utf8'),
    truncated: () => truncated
  };
}

function displayCommand(command, args) {
  const sensitiveArgument = /^--?(?:api[-_]?key|access[-_]?token|auth[-_]?token|token|password|secret|authorization)$/i;
  let redactNext = false;
  const safeParts = [command, ...args].map((part) => {
    if (redactNext) {
      redactNext = false;
      return '[REDACTED ARGUMENT]';
    }
    if (sensitiveArgument.test(part)) {
      redactNext = true;
      return part;
    }
    return redactHomePaths(redactSecrets(part).text);
  });
  const rendered = safeParts
    .map((part) => (/\s|["']/u.test(part) ? JSON.stringify(part) : part))
    .join(' ');
  return redactHomePaths(redactSecrets(rendered).text);
}

function runCommand(command, args, { cwd, timeoutMs, shell }) {
  return new Promise((resolve) => {
    const started = new Date();
    let timedOut = false;
    let launchError = null;
    let forceKillTimer = null;
    let pipeTimer = null;
    let settled = false;
    const target = shell ? { command, args: [], options: {} } : resolveSpawn(command, args);
    // POSIX: lead a process group so a timeout can stop grandchildren too.
    const detached = process.platform !== 'win32';
    const child = spawn(target.command, target.args, {
      cwd,
      env: process.env,
      shell: Boolean(shell),
      detached,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...target.options
    });
    const stdout = captureStream(child.stdout);
    const stderr = captureStream(child.stderr);
    // A detached group no longer receives the terminal's Ctrl-C; forward it.
    const forward = (signal) => {
      killProcessTree(child, 'SIGKILL');
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      process.kill(process.pid, signal);
    };
    const onSigint = () => forward('SIGINT');
    const onSigterm = () => forward('SIGTERM');
    if (detached) {
      process.once('SIGINT', onSigint);
      process.once('SIGTERM', onSigterm);
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => killProcessTree(child, 'SIGKILL'), KILL_GRACE_MS);
      forceKillTimer.unref?.();
    }, timeoutMs);
    timeout.unref?.();

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (pipeTimer) clearTimeout(pipeTimer);
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      child.stdout?.destroy();
      child.stderr?.destroy();
      const finished = new Date();
      const rawStdout = stdout.value();
      const rawStderr = launchError ? launchError.message : stderr.value();
      const stdoutValue = redactHomePaths(redactSecrets(rawStdout).text);
      const stderrValue = redactHomePaths(redactSecrets(rawStderr).text);
      resolve({
        command: displayCommand(command, args),
        executionIdentity: `pid:${child.pid || process.pid}`,
        startTime: started.toISOString(),
        endTime: finished.toISOString(),
        durationMs: Math.max(0, finished.getTime() - started.getTime()),
        exitCode: launchError ? 127 : (timedOut ? (code ?? 124) : (code ?? 1)),
        signal: signal || null,
        timeoutStatus: timedOut ? 'TIMED_OUT' : 'COMPLETED',
        stdout: stdoutValue || '(no stdout)',
        stdoutWasEmpty: stdoutValue.length === 0,
        stderr: stderrValue,
        stdoutTruncated: stdout.truncated(),
        stderrTruncated: stderr.truncated(),
        ...(launchError ? { launchError: true } : {}),
        ...(timedOut ? { summary: `Command timed out after ${timeoutMs} ms.` } : {})
      });
    };

    child.once('error', (error) => {
      launchError = error;
      if (!child.pid) finish(null, null);
    });
    // 'close' waits for the pipes; a grandchild that escaped the group can
    // hold them open forever. After the child exits, give the pipes a grace
    // period to drain and then stop waiting.
    child.once('exit', (code, signal) => {
      pipeTimer = setTimeout(() => {
        killProcessTree(child, 'SIGKILL');
        finish(code, signal);
      }, timedOut ? KILL_GRACE_MS : PIPE_DRAIN_MS);
      pipeTimer.unref?.();
    });
    child.once('close', (code, signal) => finish(code, signal));
  });
}

// Commands can run for minutes, and other recorders may finish meanwhile.
// Re-read the Run and the bundle under a lock right before writing so no
// result is lost and nothing lands after the verification gate.
const passedRecord = (record) => record.exitCode === 0 && record.timeoutStatus === 'COMPLETED';

// Re-read under a lock right before writing so concurrent recorders never
// drop each other's results. `final` writes final-verification.json, which is
// recorded after the verification gate and has no summary.
function appendRecordedCommands(rootDir, runId, results, { filePath, gitRevision, diffHash, final = false }) {
  return withFileLock(`${filePath}.lock`, () => {
    const run = loadRun(rootDir, runId);
    if (!final && run.artifacts?.verification) {
      throw recorderError('Verification passed its gate while the command ran. Do not mutate gated evidence; start a new verification iteration instead.', 'VERIFICATION_ALREADY_GATED');
    }
    if (resolveDiff(rootDir, run) !== diffHash) {
      throw recorderError('The gated Maker diff changed while the command ran. Re-run the Maker gate.', 'STALE_DIFF');
    }
    const bundle = readExistingBundle(filePath, { runId, gitRevision, diffHash });
    // A re-run on the same diff supersedes that command's earlier failure; the
    // failure stays on record under `superseded` and the gate sees the latest.
    const rerun = new Set(results.map((result) => result.command));
    const stale = bundle.commands.filter((record) => rerun.has(record.command) && !passedRecord(record));
    if (stale.length) {
      bundle.superseded = [...(bundle.superseded || []), ...stale];
      bundle.commands = bundle.commands.filter((record) => !stale.includes(record));
    }
    bundle.commands.push(...results);
    atomicWriteJson(filePath, bundle);
    return final ? null : writeVerificationSummary(rootDir, { runId }).summary;
  });
}

async function recordVerificationCommand(rootDir, {
  runId,
  command,
  args = [],
  shell = false,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  validateRecordingRequest({ command, args, timeoutMs, shell });
  const run = resolveRun(rootDir, runId);
  if (run.artifacts?.verification) {
    throw recorderError('Verification has already passed its gate. Do not mutate gated evidence; start a new verification iteration instead.', 'VERIFICATION_ALREADY_GATED');
  }

  const diffHash = resolveDiff(rootDir, run);
  const gitRevision = getGitRevision(rootDir);
  const filePath = path.join(runsDir(rootDir), run.runId, 'verification.json');
  readExistingBundle(filePath, { runId: run.runId, gitRevision, diffHash });
  const result = await runCommand(command, args, { cwd: rootDir, timeoutMs, shell });
  const summary = appendRecordedCommands(rootDir, run.runId, [result], { filePath, gitRevision, diffHash });
  return {
    runId: run.runId,
    path: path.relative(rootDir, filePath).split(path.sep).join('/'),
    command: result,
    summary
  };
}

// Issue #34: run several verification commands in one CLI call. Independent
// commands run in parallel by default (`serial: true` opts out); results are
// appended to verification.json in the given order, in one atomic write.
// `scope` tags records ('related' for the fast lane, 'full' otherwise).
// `target: 'final'` writes final-verification.json for a run whose gated
// verification was related-only. A passing record for the same command, diff,
// and revision is reused unless `fresh` is set.
async function recordVerificationCommands(rootDir, {
  runId,
  commands = [],
  serial = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  scope = null,
  target = 'verification',
  fresh = false
} = {}) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw recorderError('Provide at least one verification command.', 'INVALID_COMMAND');
  }
  for (const item of commands) {
    validateRecordingRequest({ command: item.command, args: item.args || [], timeoutMs, shell: Boolean(item.shell) });
  }
  const run = resolveRun(rootDir, runId);
  const final = target === 'final';
  if (!final && run.artifacts?.verification) {
    throw recorderError('Verification has already passed its gate. Do not mutate gated evidence; start a new verification iteration instead.', 'VERIFICATION_ALREADY_GATED');
  }
  const diffHash = resolveDiff(rootDir, run);
  const gitRevision = getGitRevision(rootDir);
  const filePath = path.join(runsDir(rootDir), run.runId, final ? 'final-verification.json' : 'verification.json');
  const bundle = readExistingBundle(filePath, { runId: run.runId, gitRevision, diffHash });
  const exec = async (item) => {
    const display = displayCommand(item.command, item.args || []);
    const previous = fresh ? null : bundle.commands.find((record) => record.command === display && passedRecord(record)
      && (record.scope || 'full') === (scope || 'full'));
    if (previous) return { ...previous, reused: true };
    const result = await runCommand(item.command, item.args || [], { cwd: rootDir, timeoutMs, shell: Boolean(item.shell) });
    return scope ? { ...result, scope } : result;
  };
  let results;
  if (serial) {
    results = [];
    for (const item of commands) results.push(await exec(item));
  } else {
    results = await Promise.all(commands.map(exec));
  }
  const summary = appendRecordedCommands(rootDir, run.runId, results.filter((result) => !result.reused), {
    filePath, gitRevision, diffHash, final
  });
  return {
    runId: run.runId,
    path: path.relative(rootDir, filePath).split(path.sep).join('/'),
    commands: results,
    summary,
    passed: results.every(passedRecord)
  };
}

module.exports = {
  recordVerificationCommands,
  DEFAULT_TIMEOUT_MS,
  MAX_CAPTURE_BYTES,
  MAX_TIMEOUT_MS,
  recordVerificationCommand
};
