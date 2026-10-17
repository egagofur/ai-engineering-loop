'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, test } = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');
const { createRun } = require('../lib/run-state.js');
const { createStudioServer, readStudioUrl } = require('../lib/studio-server.js');
const { ARTIFACT_FILES, envWatchEnabled, loadArtifactSummaries } = require('../lib/run-watcher.js');
const { isBlockingFinding } = require('../lib/orchestration.js');
const { checkGuard } = require('../lib/guard.js');

const CLI = path.join(__dirname, '..', 'bin', 'ai-engineering-loop.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-events-'));
}

function parseSseBlocks(buffer) {
  const parts = buffer.split('\n\n');
  const rest = parts.pop();
  const events = [];
  for (const block of parts) {
    if (!block.trim()) continue;
    let type = 'message';
    let data = '';
    let id = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
      else if (line.startsWith('id:')) id = line.slice(3).trim();
    }
    let payload = null;
    try { payload = data ? JSON.parse(data) : null; } catch { payload = null; }
    events.push({ type, id, payload, arrivedAt: Date.now() });
  }
  return { events, rest };
}

function eventSeq(event) {
  const value = Number(event?.payload?.seq);
  return Number.isFinite(value) ? value : 0;
}

async function openSse(url, headers) {
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const received = [];
  const pumping = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseSseBlocks(buffer);
        buffer = parsed.rest;
        received.push(...parsed.events);
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
  })();
  async function waitFor(predicate, timeoutMs = 800) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (received.some(predicate)) return received.filter(predicate);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`Timed out waiting for SSE event. Saw: ${received.map((event) => event.type).join(', ')}`);
  }
  async function waitForNew(predicate, timeoutMs = 800) {
    const origin = received.length;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const fresh = received.slice(origin);
      if (fresh.some(predicate)) return fresh.filter(predicate);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(`Timed out waiting for new SSE event. Saw: ${received.map((event) => event.type).join(', ')}`);
  }
  async function close() {
    controller.abort();
    try { await reader.cancel(); } catch { /* already closed */ }
    try { await pumping; } catch { /* aborted */ }
  }
  return { received, waitFor, waitForNew, close, controller };
}

async function withStudio(operation, options = {}) {
  const root = tempRepo();
  const instance = createStudioServer(root, { token: 'events-token', ...options });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = instance.server.address();
    await operation({
      base: `http://127.0.0.1:${port}`,
      token: instance.token,
      root,
      watcher: instance.watcher,
      headers: { 'x-ael-studio-token': instance.token }
    });
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
}

const FAST = { debounceMs: 20, pollMs: 40 };

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function verificationCommand(overrides = {}) {
  return {
    command: 'node --test',
    executionIdentity: 'pid:123',
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    exitCode: 0,
    signal: null,
    timeoutStatus: 'COMPLETED',
    stdout: 'ok',
    stdoutWasEmpty: false,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides
  };
}

function verificationBundle(runId, commands) {
  return {
    schemaVersion: 1,
    runId,
    gitRevision: 'abc123',
    diffHash: 'def456',
    commands
  };
}

function finding(overrides = {}) {
  return {
    id: 'F-1',
    location: 'lib/example.js:1',
    failureScenario: 'the change breaks the contract',
    evidence: 'test output',
    severity: 'BLOCKER',
    validity: 'VALID',
    disposition: 'STRONG',
    axis: 'spec',
    concreteAlternativeDiff: '--- a\n+++ b\n',
    ...overrides
  };
}

function findingsBundle(runId, findings) {
  return { schemaVersion: 1, runId, diffHash: 'def456', findings };
}

function impactMapFixture(runId) {
  return {
    schemaVersion: 1,
    runId,
    goalHash: 'aa'.repeat(32),
    status: 'DRAFT',
    generator: 'heuristic-v1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    keywords: ['studio'],
    files: [{ path: 'lib/studio-server.js', reason: 'mentioned in the Goal', confidence: 0.8 }],
    modules: [],
    endpoints: [],
    dbTables: [],
    tests: [],
    scope: null
  };
}

function impactDriftFixture(runId) {
  return {
    schemaVersion: 1,
    runId,
    diffHash: 'def456',
    mapStatus: 'CONFIRMED',
    checkedAt: '2026-01-01T00:00:00.000Z',
    changedFiles: ['extra.js'],
    outOfMap: ['extra.js']
  };
}

function verdictFixture(runId) {
  return {
    schemaVersion: 1,
    runId,
    verdict: 'PASS',
    reason: 'All acceptance criteria have current evidence',
    action: 'Proceed to delivery'
  };
}

function receiptFixture(runId) {
  return {
    schemaVersion: 1,
    runId,
    generatedAt: '2026-01-01T00:00:00.000Z',
    digest: 'aa'.repeat(32),
    artifacts: [],
    goal: {
      path: `.ai-engineering-loop/runs/${runId}/goal-contract.json`,
      sha256: 'bb'.repeat(32),
      contentHash: 'cc'.repeat(32),
      version: 1,
      objective: 'fixture'
    }
  };
}

describe('Studio real-time events #80', { concurrency: false }, () => {
  test('AC1 CLI artifact writes reach an open Studio SSE client within 500ms', async () => {
    await withStudio(async ({ base, headers, root }) => {
      const run = createRun(root, { runId: 'run-cli-live', task: 'Stream from the terminal' });
      const sse = await openSse(`${base}/api/events`, headers);
      await sse.waitFor((event) => event.type === 'hello');
      const before = Date.now();
      execFileSync(process.execPath, [
        CLI, 'activity', 'heartbeat', '--run', run.runId, '--phase', 'goal', '--message', 'Drafting the Goal'
      ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const ledger = path.join(root, '.ai-engineering-loop', 'runs', run.runId, 'lifecycle.jsonl');
      assert.equal(fs.existsSync(ledger), true, 'CLI heartbeat must write lifecycle.jsonl');
      const hits = await sse.waitForNew(
        (event) => event.type === 'lifecycle' && event.payload?.runId === run.runId,
        500
      );
      assert.ok(hits[0].arrivedAt - before <= 500, `lifecycle event took ${hits[0].arrivedAt - before}ms`);
      const verificationPath = path.join(root, '.ai-engineering-loop', 'runs', run.runId, 'verification.json');
      const writtenAt = Date.now();
      writeJson(verificationPath, verificationBundle(run.runId, [verificationCommand()]));
      const artifacts = await sse.waitForNew(
        (event) => event.type === 'artifact.verification' && event.payload?.runId === run.runId,
        500
      );
      assert.ok(artifacts[0].arrivedAt - writtenAt <= 500, `verification event took ${artifacts[0].arrivedAt - writtenAt}ms`);
      await sse.close();
    }, { watch: true, ...FAST });
  });

  test('AC2 each watched artifact produces a typed event', async () => {
    await withStudio(async ({ base, headers, root }) => {
      const run = createRun(root, { runId: 'run-artifacts', task: 'Emit every artifact' });
      const sse = await openSse(`${base}/api/events`, headers);
      await sse.waitFor((event) => event.type === 'hello');
      const runDir = path.join(root, '.ai-engineering-loop', 'runs', run.runId);
      const ledger = [
        finding({ id: 'F-block', severity: 'BLOCKER', validity: 'VALID' }),
        finding({ id: 'F-high', severity: 'HIGH', validity: 'VALID' }),
        finding({ id: 'F-invalid', severity: 'BLOCKER', validity: 'INVALID', concreteAlternativeDiff: undefined }),
        finding({
          id: 'F-standards',
          severity: 'HIGH',
          validity: 'VALID',
          axis: 'standards',
          hardConvention: false
        })
      ];
      const rows = [
        ['state.json', 'run.state', { ...JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')), iteration: 2 }],
        ['impact-map.json', 'artifact.impact', impactMapFixture(run.runId)],
        ['impact-drift.json', 'artifact.drift', impactDriftFixture(run.runId)],
        ['verification.json', 'artifact.verification', verificationBundle(run.runId, [verificationCommand()])],
        ['findings.json', 'artifact.findings', findingsBundle(run.runId, ledger)],
        ['verdict.json', 'artifact.verdict', verdictFixture(run.runId)],
        ['receipt.json', 'artifact.receipt', receiptFixture(run.runId)]
      ];
      checkGuard(root, { tool: 'bash', input: { command: 'rm -rf /tmp/ael-guard-fixture' }, runId: run.runId });
      const guardHits = await sse.waitForNew(
        (event) => event.type === 'artifact.guard' && event.payload?.runId === run.runId,
        800
      );
      assert.equal(guardHits.at(-1).type, 'artifact.guard');
      assert.ok((guardHits.at(-1).payload.payload.warn || 0) + (guardHits.at(-1).payload.payload.block || 0) >= 1);

      assert.equal(rows.length + 1, Object.keys(ARTIFACT_FILES).length);
      for (const [name, type, value] of rows) {
        writeJson(path.join(runDir, name), value);
        const hits = await sse.waitForNew(
          (event) => event.type === type && event.payload?.runId === run.runId,
          800
        );
        assert.equal(hits.at(-1).type, type);
        const summary = hits.at(-1).payload.payload;
        if (type === 'artifact.verification') {
          assert.equal(summary.passed, true);
          assert.equal(summary.failed, 0);
          assert.equal(summary.commandCount, 1);
          assert.equal(summary.status, undefined);
        }
        if (type === 'artifact.findings') {
          assert.equal(summary.count, ledger.length);
          assert.equal(summary.blocking, ledger.filter(isBlockingFinding).length);
        }
        if (type === 'artifact.receipt') {
          assert.equal(summary.present, true);
          assert.equal(typeof summary.digest, 'string');
          assert.equal(summary.verified, false);
          assert.ok(Array.isArray(summary.problems) && summary.problems.length > 0);
        }
      }
      await sse.close();
    }, { watch: true, ...FAST });
  });

  test('artifact summaries match real writer shapes', () => {
    const root = tempRepo();
    const run = createRun(root, { runId: 'run-sum', task: 'Summaries' });
    const runDir = path.join(root, '.ai-engineering-loop', 'runs', run.runId);
    writeJson(
      path.join(runDir, 'verification.json'),
      verificationBundle(run.runId, [
        verificationCommand(),
        verificationCommand({ command: 'node fail.js', exitCode: 1, timeoutStatus: 'COMPLETED' })
      ])
    );
    const ledger = [
      finding({ id: 'F-block', severity: 'BLOCKER', validity: 'VALID' }),
      finding({ id: 'F-high', severity: 'HIGH', validity: 'VALID', disposition: 'ACCEPTABLE' }),
      finding({ id: 'F-invalid', severity: 'BLOCKER', validity: 'INVALID', concreteAlternativeDiff: undefined }),
      finding({
        id: 'F-standards',
        severity: 'HIGH',
        validity: 'VALID',
        axis: 'standards',
        hardConvention: false
      })
    ];
    writeJson(path.join(runDir, 'findings.json'), findingsBundle(run.runId, ledger));
    writeJson(path.join(runDir, 'receipt.json'), receiptFixture(run.runId));
    checkGuard(root, { tool: 'bash', input: { command: 'rm -rf /tmp/ael-guard-fixture' }, runId: run.runId });
    const summaries = loadArtifactSummaries(root, run.runId);
    assert.equal(summaries['artifact.verification'].passed, false);
    assert.equal(summaries['artifact.verification'].failed, 1);
    assert.equal(summaries['artifact.verification'].commandCount, 2);
    assert.equal(summaries['artifact.verification'].status, undefined);
    assert.equal(summaries['artifact.findings'].count, ledger.length);
    assert.equal(summaries['artifact.findings'].blocking, ledger.filter(isBlockingFinding).length);
    assert.equal(summaries['artifact.findings'].blocking, 2);
    assert.equal(summaries['artifact.receipt'].present, true);
    assert.equal(summaries['artifact.receipt'].verified, false);
    assert.ok(summaries['artifact.receipt'].problems.includes('RECEIPT_DIGEST_MISMATCH')
      || summaries['artifact.receipt'].problems.length > 0);
    assert.ok((summaries['artifact.guard'].warn || 0) + (summaries['artifact.guard'].block || 0) >= 1);
  });

  test('AC3 pinned non-current and classic runs stream live', async () => {
    await withStudio(async ({ base, headers, root }) => {
      const first = createRun(root, { runId: 'run-classic', task: 'Classic without workflow' });
      const second = createRun(root, { runId: 'run-current', task: 'Becomes current' });
      const sse = await openSse(`${base}/api/events`, headers);
      await sse.waitFor((event) => event.type === 'hello');
      const liveClassic = await fetch(`${base}/api/live?runId=${first.runId}`, { headers });
      const classicBody = await liveClassic.json();
      assert.equal(classicBody.live.run.runId, first.runId);
      assert.equal(classicBody.live.workflowBound, false);
      assert.equal(classicBody.live.current, false);
      const liveCurrent = await fetch(`${base}/api/live?runId=${second.runId}`, { headers });
      assert.equal((await liveCurrent.json()).live.current, true);
      writeJson(
        path.join(root, '.ai-engineering-loop', 'runs', first.runId, 'receipt.json'),
        receiptFixture(first.runId)
      );
      const hits = await sse.waitForNew(
        (event) => event.type === 'artifact.receipt' && event.payload?.runId === first.runId,
        800
      );
      assert.equal(hits.at(-1).payload.runId, first.runId);
      await sse.close();
    }, { watch: true, ...FAST });
  });

  test('AC4 stat-poll fallback reports poll and delivers the same events', async () => {
    assert.equal(envWatchEnabled({ AEL_STUDIO_FS_WATCH: '0' }), false);
    assert.equal(envWatchEnabled({ AEL_STUDIO_FS_WATCH: 'false' }), false);
    assert.equal(envWatchEnabled({ AEL_STUDIO_FS_WATCH: 'off' }), false);
    assert.equal(envWatchEnabled({ AEL_STUDIO_FS_WATCH: 'poll' }), false);
    assert.equal(envWatchEnabled({}), true);
    const previous = process.env.AEL_STUDIO_FS_WATCH;
    process.env.AEL_STUDIO_FS_WATCH = '0';
    try {
      await withStudio(async ({ base, headers, root, watcher }) => {
        assert.equal(watcher.mode, 'poll');
        const run = createRun(root, { runId: 'run-poll', task: 'Poll fallback' });
        const sse = await openSse(`${base}/api/events`, headers);
        const hello = (await sse.waitFor((event) => event.type === 'hello'))[0];
        assert.equal(hello.payload.mode, 'poll');
        const bootstrap = await (await fetch(`${base}/api/bootstrap`, { headers })).json();
        assert.equal(bootstrap.watchMode, 'poll');
        writeJson(
          path.join(root, '.ai-engineering-loop', 'runs', run.runId, 'findings.json'),
          findingsBundle(run.runId, [])
        );
        const hits = await sse.waitForNew(
          (event) => event.type === 'artifact.findings' && event.payload?.runId === run.runId,
          1500
        );
        assert.equal(hits.at(-1).type, 'artifact.findings');
        await sse.close();
      }, { watch: false, pollMs: 40, debounceMs: 10 });
    } finally {
      if (previous == null) delete process.env.AEL_STUDIO_FS_WATCH;
      else process.env.AEL_STUDIO_FS_WATCH = previous;
    }
  });

  test('AC5 Last-Event-ID resumes without duplicates and a ring gap asks for resync', async () => {
    await withStudio(async ({ base, headers, root }) => {
      const run = createRun(root, { runId: 'run-resume', task: 'Resume the stream' });
      const runDir = path.join(root, '.ai-engineering-loop', 'runs', run.runId);
      const first = await openSse(`${base}/api/events`, headers);
      await first.waitFor((event) => event.type === 'hello');
      writeJson(path.join(runDir, 'verdict.json'), verdictFixture(run.runId));
      const seen = await first.waitForNew((event) => event.type === 'artifact.verdict', 800);
      const lastSeq = eventSeq(seen.at(-1));
      await first.close();
      const resume = await openSse(`${base}/api/events?after=${lastSeq}`, {
        ...headers,
        'Last-Event-ID': String(lastSeq)
      });
      await resume.waitFor((event) => event.type === 'hello');
      await new Promise((resolve) => setTimeout(resolve, 40));
      const replayed = resume.received.filter((event) => event.type === 'artifact.verdict');
      assert.equal(replayed.length, 0);
      writeJson(path.join(runDir, 'receipt.json'), receiptFixture(run.runId));
      const next = await resume.waitForNew((event) => event.type === 'artifact.receipt', 800);
      assert.ok(eventSeq(next[0]) > lastSeq);
      await resume.close();
    }, { watch: true, ...FAST });

    await withStudio(async ({ base, headers, root }) => {
      const run = createRun(root, { runId: 'run-gap', task: 'Overflow the ring' });
      const runDir = path.join(root, '.ai-engineering-loop', 'runs', run.runId);
      for (let index = 0; index < 6; index += 1) {
        writeJson(
          path.join(runDir, 'guard-events.json'),
          { schemaVersion: 1, runId: run.runId, events: [{ at: new Date().toISOString(), tool: 'bash', decision: 'warn', mode: 'ASSISTED', rules: ['rm-rf'], reasons: ['n'], target: String(index) }] }
        );
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      const sse = await openSse(`${base}/api/events?after=1`, headers);
      const gap = await sse.waitFor((event) => event.type === 'resync', 800);
      assert.equal(gap[0].type, 'resync');
      await sse.close();
    }, { ringSize: 3, debounceMs: 10, watch: false, pollMs: 20 });
  });

  test('AC6 Studio client has no live setInterval chain and the server has no per-client lifecycle interval', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '..', 'lib', 'studio-server.js'), 'utf8');
    assert.doesNotMatch(app, /setInterval/);
    assert.doesNotMatch(app, /refreshLive/);
    assert.doesNotMatch(app, /1800/);
    assert.doesNotMatch(server, /setInterval/);
    assert.doesNotMatch(server, /streamRunLifecycle/);
    assert.doesNotMatch(server, /\b750\b/);
  });

  test('AC10 Studio shows the watched root and status --json reports the Studio URL', async () => {
    await withStudio(async ({ base, headers, root, token }) => {
      const bootstrap = await (await fetch(`${base}/api/bootstrap`, { headers })).json();
      assert.equal(bootstrap.root, path.resolve(root));
      const studioUrl = readStudioUrl(root);
      assert.equal(studioUrl, base);
      const advertised = fs.readFileSync(path.join(root, '.ai-engineering-loop', 'studio.json'), 'utf8');
      assert.equal(advertised.includes(token), false);
      assert.equal((await fetch(studioUrl)).status, 401);
      const status = spawnSync(process.execPath, [CLI, 'status', '--json'], {
        cwd: root,
        encoding: 'utf8'
      });
      const parsed = JSON.parse(status.stdout);
      assert.equal(parsed.studioUrl, base);
    }, { watch: false, pollMs: 10_000 });
  });

  test('readStudioUrl is null when studio.json root differs', async () => {
    await withStudio(async ({ root }) => {
      const file = path.join(root, '.ai-engineering-loop', 'studio.json');
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      stored.root = '/tmp/some-other-project';
      fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
      assert.equal(readStudioUrl(root), null);
    }, { watch: false, pollMs: 10_000 });
  });

  test('RunWatcher ignores usage and learnings paths outside runs/', async () => {
    await withStudio(async ({ base, headers, root, watcher }) => {
      const sse = await openSse(`${base}/api/events`, headers);
      await sse.waitFor((event) => event.type === 'hello');
      const seq = watcher.seq;
      const contextDir = path.join(root, '.ai-engineering-loop');
      fs.mkdirSync(path.join(contextDir, 'usage'), { recursive: true });
      fs.writeFileSync(path.join(contextDir, 'usage', 'x.jsonl'), '{"tokens":1}\n');
      fs.writeFileSync(path.join(contextDir, 'learnings.json'), '{}\n');
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(watcher.seq, seq);
      assert.equal(sse.received.filter((event) => event.type !== 'hello').length, 0);
      await sse.close();
    }, { watch: true, ...FAST });
  });
});
