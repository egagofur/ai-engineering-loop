'use strict';

const fs = require('fs');
const path = require('path');
const { currentRunPath, getCurrentRun, runsDir } = require('./run-state.js');
const { listRunLifecycle, runAgentPresence } = require('./run-lifecycle.js');
const { listRunInteractions } = require('./run-interactions.js');
const { isBlockingFinding } = require('./orchestration.js');
const { verifyReceipt } = require('./receipt.js');

const WATCH_ENV = 'AEL_STUDIO_FS_WATCH';
const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_POLL_MS = 1000;
const DEFAULT_RING_SIZE = 512;
const CURRENT_POINTER = 'current.json';

const ARTIFACT_FILES = Object.freeze({
  'state.json': { type: 'run.state', summarize: summarizeState },
  'impact-map.json': { type: 'artifact.impact', summarize: summarizeImpact },
  'impact-drift.json': { type: 'artifact.drift', summarize: summarizeDrift },
  'guard-events.json': { type: 'artifact.guard', summarize: summarizeGuard },
  'verification.json': { type: 'artifact.verification', summarize: summarizeVerification },
  'findings.json': { type: 'artifact.findings', summarize: summarizeFindings },
  'verdict.json': { type: 'artifact.verdict', summarize: summarizeVerdict },
  'receipt.json': { type: 'artifact.receipt', summarize: summarizeReceipt },
  'delivery.json': { type: 'artifact.delivery', summarize: summarizeDelivery }
});

function envWatchEnabled(env = process.env) {
  const value = env[WATCH_ENV];
  if (value == null || value === '') return true;
  return !['0', 'false', 'off', 'poll'].includes(String(value).toLowerCase());
}

function isTransientName(name) {
  return /\.tmp$|\.lock$|~$/.test(name) || name.includes('.tmp.');
}

function readJsonFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    return {
      value: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };
  } catch {
    return null;
  }
}

function fingerprintStat(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return null;
    return `${stat.mtimeMs}:${stat.size}:${stat.isDirectory() ? 'd' : 'f'}`;
  } catch {
    return null;
  }
}

function summarizeState(value) {
  return {
    state: value?.state || null,
    iteration: value?.iteration ?? null,
    mode: value?.mode || null,
    tier: value?.tier?.current || null,
    updatedAt: value?.updatedAt || null,
    workflowBound: Boolean(value?.workflow),
    task: value?.task || '',
    displayName: value?.displayName || ''
  };
}

function summarizeImpact(value) {
  return {
    status: value?.status || null,
    fileCount: Array.isArray(value?.files) ? value.files.length : 0
  };
}

function summarizeDrift(value) {
  const outOfMap = Array.isArray(value?.outOfMap) ? value.outOfMap : [];
  return {
    mapStatus: value?.mapStatus || null,
    outOfMapCount: outOfMap.length
  };
}

function summarizeGuard(value) {
  const events = Array.isArray(value?.events) ? value.events : [];
  return {
    warn: events.filter((event) => event?.decision === 'warn' || event?.action === 'warn').length,
    block: events.filter((event) => event?.decision === 'block' || event?.action === 'block').length,
    count: events.length
  };
}

function commandFailed(command) {
  return command?.exitCode !== 0 || command?.timeoutStatus !== 'COMPLETED';
}

function summarizeVerification(value) {
  const commands = Array.isArray(value?.commands) ? value.commands : [];
  const failed = commands.filter(commandFailed).length;
  return {
    passed: commands.length > 0 && failed === 0,
    failed,
    commandCount: commands.length
  };
}

function summarizeFindings(value) {
  const findings = Array.isArray(value?.findings) ? value.findings : [];
  return {
    count: findings.length,
    blocking: findings.filter(isBlockingFinding).length
  };
}

function summarizeVerdict(value) {
  return {
    verdict: value?.verdict || null,
    action: value?.action || null
  };
}

function summarizeDelivery(value) {
  return {
    destination: typeof value?.destination === 'string' ? value.destination : null,
    humanApproved: value?.humanApproved === true,
    approvedBy: typeof value?.approvedBy === 'string' ? value.approvedBy : null
  };
}

function summarizeReceipt(value, context = {}) {
  const digest = value?.digest || null;
  const { rootDir, runId } = context;
  if (!rootDir || !runId) {
    return { present: true, digest, verified: false, problems: ['RECEIPT_UNVERIFIED'] };
  }
  try {
    const result = verifyReceipt(rootDir, { runId });
    const problems = (result.problems || []).map((item) => item.code || String(item));
    return {
      present: true,
      digest: result.digest || digest,
      verified: problems.length === 0,
      problems
    };
  } catch (error) {
    return {
      present: true,
      digest,
      verified: false,
      problems: [error.code || 'RECEIPT_FAILED']
    };
  }
}

function summarizeNamedArtifact(name, value, context) {
  return ARTIFACT_FILES[name]?.summarize(value, context) || { present: true };
}

function compactPresence(rootDir, runId) {
  try {
    const presence = runAgentPresence(rootDir, runId);
    let pendingQuestions = 0;
    try {
      pendingQuestions = listRunInteractions(rootDir, runId).pending.length;
    } catch {
      pendingQuestions = 0;
    }
    return { ...presence, pendingQuestions };
  } catch {
    return { status: 'UNKNOWN', lastHeartbeatAt: null, pendingQuestions: 0 };
  }
}

function currentPointer(rootDir) {
  try {
    const run = getCurrentRun(rootDir);
    return run?.runId || null;
  } catch {
    return null;
  }
}

function listRunIds(rootDir) {
  const directory = runsDir(rootDir);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== CURRENT_POINTER && !isTransientName(entry.name))
    .map((entry) => entry.name);
}

function createRunWatcher(rootDir, options = {}) {
  const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : DEFAULT_DEBOUNCE_MS;
  const pollMs = Number.isFinite(options.pollMs) ? options.pollMs : DEFAULT_POLL_MS;
  const ringSize = Number.isFinite(options.ringSize) ? options.ringSize : DEFAULT_RING_SIZE;
  const watchRequested = options.watch == null ? envWatchEnabled() : options.watch === true;
  const contextDir = path.join(rootDir, '.ai-engineering-loop');
  const runRoot = runsDir(rootDir);
  const pointerPath = currentRunPath(rootDir);

  let mode = watchRequested ? 'watch' : 'poll';
  let seq = 0;
  let started = false;
  const ring = [];
  const listeners = new Set();
  const fingerprints = new Map();
  const knownRuns = new Set();
  const lifecycleCursor = new Map();
  const presenceFingerprints = new Map();
  const debounceTimers = new Map();
  const fsWatchers = [];
  let pollTimer = null;

  function hello() {
    return {
      type: 'hello',
      seq,
      mode,
      root: path.resolve(rootDir),
      currentRunId: currentPointer(rootDir),
      ringStart: ring[0]?.seq || seq,
      nextSeq: seq
    };
  }

  function eventsAfter(after) {
    const cursor = Number(after);
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      const error = new Error('Event cursor is invalid');
      error.code = 'INVALID_EVENT_CURSOR';
      throw error;
    }
    if (ring.length === 0) return { gap: false, events: [] };
    const ringStart = ring[0].seq;
    if (cursor + 1 < ringStart) return { gap: true, ringStart, events: [] };
    return { gap: false, ringStart, events: ring.filter((event) => event.seq > cursor) };
  }

  function publish(type, runId, payload) {
    seq += 1;
    const event = {
      type,
      seq,
      runId: runId || null,
      at: new Date().toISOString(),
      payload: payload || {}
    };
    ring.push(event);
    while (ring.length > ringSize) ring.shift();
    for (const listener of listeners) {
      try { listener(event); } catch { /* a broken subscriber must not stop the others */ }
    }
    return event;
  }

  function noteFingerprint(key, filePath) {
    const next = fingerprintStat(filePath);
    const previous = fingerprints.get(key);
    if (next === previous) return false;
    if (next) fingerprints.set(key, next);
    else fingerprints.delete(key);
    return true;
  }

  function emitPresence(runId) {
    const presence = compactPresence(rootDir, runId);
    const encoded = JSON.stringify(presence);
    if (presenceFingerprints.get(runId) === encoded) return;
    presenceFingerprints.set(runId, encoded);
    publish('presence', runId, presence);
  }

  function emitLifecycle(runId) {
    for (;;) {
      const after = lifecycleCursor.get(runId) || 0;
      let listed;
      try {
        listed = listRunLifecycle(rootDir, runId, { after, limit: 100 });
      } catch {
        return;
      }
      if (!listed.events.length) break;
      lifecycleCursor.set(runId, listed.nextSequence);
      publish('lifecycle', runId, listed);
      if (listed.events.length < 100) break;
    }
    emitPresence(runId);
  }

  function emitArtifact(runId, name) {
    const spec = ARTIFACT_FILES[name];
    if (!spec) return;
    const filePath = path.join(runRoot, runId, name);
    const key = `${runId}/${name}`;
    if (!noteFingerprint(key, filePath) && fingerprints.has(key)) return;
    const read = readJsonFile(filePath);
    if (!read) return;
    if (name === 'state.json' && !knownRuns.has(runId)) {
      knownRuns.add(runId);
      publish('run.created', runId, { runId, ...summarizeState(read.value) });
    }
    publish(spec.type, runId, spec.summarize(read.value, { rootDir, runId }));
  }

  function emitCurrent() {
    if (!noteFingerprint(CURRENT_POINTER, pointerPath) && fingerprints.has(CURRENT_POINTER)) return;
    let runId = null;
    try {
      runId = currentPointer(rootDir);
    } catch {
      runId = null;
    }
    publish('current.changed', runId, { runId });
  }

  function processRunFile(runId, name) {
    if (name === 'lifecycle.jsonl' || name === 'interactions.jsonl') {
      const filePath = path.join(runRoot, runId, name);
      if (!noteFingerprint(`${runId}/${name}`, filePath) && fingerprints.has(`${runId}/${name}`)) return;
      emitLifecycle(runId);
      return;
    }
    if (ARTIFACT_FILES[name]) emitArtifact(runId, name);
  }

  function seedLifecycleCursor(runId) {
    try {
      const all = listRunLifecycle(rootDir, runId, { after: 0, limit: 1, latest: true });
      lifecycleCursor.set(runId, all.nextSequence);
    } catch {
      lifecycleCursor.set(runId, 0);
    }
    presenceFingerprints.set(runId, JSON.stringify(compactPresence(rootDir, runId)));
  }

  function scanRun(runId, { announceNew = true } = {}) {
    const directory = path.join(runRoot, runId);
    if (!fs.existsSync(directory)) return;
    if (!announceNew) knownRuns.add(runId);
    for (const name of Object.keys(ARTIFACT_FILES)) {
      const filePath = path.join(directory, name);
      if (!fs.existsSync(filePath)) continue;
      if (announceNew) emitArtifact(runId, name);
      else noteFingerprint(`${runId}/${name}`, filePath);
    }
    for (const name of ['lifecycle.jsonl', 'interactions.jsonl']) {
      const filePath = path.join(directory, name);
      if (!fs.existsSync(filePath)) continue;
      if (announceNew) {
        if (!noteFingerprint(`${runId}/${name}`, filePath) && fingerprints.has(`${runId}/${name}`)) continue;
        emitLifecycle(runId);
      } else {
        noteFingerprint(`${runId}/${name}`, filePath);
        seedLifecycleCursor(runId);
      }
    }
  }

  function scanAll({ announceNew = false } = {}) {
    if (fs.existsSync(pointerPath)) {
      if (announceNew) emitCurrent();
      else noteFingerprint(CURRENT_POINTER, pointerPath);
    }
    for (const runId of listRunIds(rootDir)) scanRun(runId, { announceNew });
  }

  function schedule(key, work) {
    const previous = debounceTimers.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      debounceTimers.delete(key);
      try { work(); } catch { /* a single bad file must not stop the watcher */ }
    }, debounceMs);
    timer.unref?.();
    debounceTimers.set(key, timer);
  }

  function handleRelativePath(relative, origin = 'context') {
    const normalized = String(relative || '').replace(/\\/g, '/');
    if (!normalized || isTransientName(path.basename(normalized))) return;
    const parts = normalized.split('/').filter(Boolean);
    let fromRuns;
    if (origin === 'runs') {
      fromRuns = parts;
    } else if (parts[0] === CURRENT_POINTER && parts.length === 1) {
      schedule(CURRENT_POINTER, emitCurrent);
      return;
    } else if (parts[0] !== 'runs') {
      return;
    } else {
      fromRuns = parts.slice(1);
    }
    if (!fromRuns.length) return;
    if (fromRuns[0] === CURRENT_POINTER && fromRuns.length === 1) {
      schedule(CURRENT_POINTER, emitCurrent);
      return;
    }
    if (fromRuns.length < 2) {
      if (fromRuns.length === 1 && fromRuns[0] !== CURRENT_POINTER) {
        const runId = fromRuns[0];
        schedule(runId, () => scanRun(runId, { announceNew: true }));
      }
      return;
    }
    const runId = fromRuns[0];
    const name = fromRuns[fromRuns.length - 1];
    schedule(`${runId}/${name}`, () => processRunFile(runId, name));
  }

  function onFsEvent(origin, _eventType, filename) {
    if (!filename) {
      schedule('scan', () => scanAll({ announceNew: true }));
      return;
    }
    handleRelativePath(String(filename), origin);
  }

  function watchPath(target, recursive, origin) {
    try {
      const watcher = fs.watch(target, recursive ? { recursive: true } : {}, (eventType, filename) => {
        onFsEvent(origin, eventType, filename);
      });
      watcher.on('error', () => {});
      fsWatchers.push(watcher);
      return true;
    } catch {
      return false;
    }
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      try { scanAll({ announceNew: true }); } catch { /* keep polling */ }
    }, pollMs);
    pollTimer.unref?.();
  }

  function start() {
    if (started) return;
    started = true;
    fs.mkdirSync(runRoot, { recursive: true, mode: 0o700 });
    scanAll({ announceNew: false });
    if (watchRequested) {
      const watched = watchPath(contextDir, true, 'context')
        || watchPath(runRoot, true, 'runs')
        || watchPath(runRoot, false, 'runs');
      if (watched) {
        mode = 'watch';
        if (fs.existsSync(pointerPath)) watchPath(path.dirname(pointerPath), false, 'runs');
      } else {
        mode = 'poll';
      }
    } else {
      mode = 'poll';
    }
    // Stat-poll always runs. Fingerprints drop duplicates, so it is a safety
    // net when FSEvents miss a write rather than a second event stream.
    startPoll();
  }

  function stop() {
    started = false;
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    for (const watcher of fsWatchers) {
      try { watcher.close(); } catch { /* already closed */ }
    }
    fsWatchers.length = 0;
    listeners.clear();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    get mode() { return mode; },
    get seq() { return seq; },
    get ringSize() { return ringSize; },
    start,
    stop,
    subscribe,
    eventsAfter,
    hello,
    scanAll
  };
}

function loadArtifactSummaries(rootDir, runId) {
  const directory = path.join(runsDir(rootDir), runId);
  const artifacts = {};
  for (const [name, spec] of Object.entries(ARTIFACT_FILES)) {
    const read = readJsonFile(path.join(directory, name));
    artifacts[spec.type] = read ? spec.summarize(read.value, { rootDir, runId }) : null;
  }
  return artifacts;
}

module.exports = {
  ARTIFACT_FILES,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_POLL_MS,
  DEFAULT_RING_SIZE,
  WATCH_ENV,
  compactPresence,
  createRunWatcher,
  envWatchEnabled,
  loadArtifactSummaries,
  summarizeNamedArtifact
};
