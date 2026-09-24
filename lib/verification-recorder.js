'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  atomicWriteJson,
  getCurrentRun,
  getGitRevision,
  loadRun,
  runsDir
} = require('./run-state.js');
const { hashFile } = require('./gates.js');
const { redactHomePaths, redactSecrets } = require('./safe-context.js');
const { writeVerificationSummary } = require('./verification-summary.js');

const MAX_CAPTURE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const KILL_GRACE_MS = 2_000;

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
    const child = spawn(command, shell ? [] : args, {
      cwd,
      env: process.env,
      shell: Boolean(shell),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = captureStream(child.stdout);
    const stderr = captureStream(child.stderr);

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      forceKillTimer.unref?.();
    }, timeoutMs);
    timeout.unref?.();

    child.once('error', (error) => {
      launchError = error;
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
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
    });
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
  const bundle = readExistingBundle(filePath, { runId: run.runId, gitRevision, diffHash });
  const result = await runCommand(command, args, { cwd: rootDir, timeoutMs, shell });
  bundle.commands.push(result);
  atomicWriteJson(filePath, bundle);

  const summary = writeVerificationSummary(rootDir, { runId: run.runId }).summary;
  return {
    runId: run.runId,
    path: path.relative(rootDir, filePath).split(path.sep).join('/'),
    command: result,
    summary
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_CAPTURE_BYTES,
  MAX_TIMEOUT_MS,
  recordVerificationCommand
};
