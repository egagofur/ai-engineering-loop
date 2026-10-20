'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const { canonicalJson, listRecipes, loadRecipe, validateRecipe, compileRecipe } = require('./recipe.js');
const {
  inspectRecipe,
  installRecipe,
  recipeCatalog
} = require('./recipe-builder.js');
const { getCurrentRun, loadRun, updateRunDisplayName } = require('./run-state.js');
const { ensurePrivateRuntimeIgnores } = require('./runtime-files.js');
const {
  compactPresence,
  createRunWatcher,
  loadArtifactSummaries
} = require('./run-watcher.js');
const { budgetStatus } = require('./budget.js');
const {
  workflowStatus,
  approveWorkflowNode,
  completeWorkflowNode,
  failWorkflowNode,
  retryWorkflowNode,
  startWorkflowNode,
  recordWorkflowActivity,
  resolveLoopLimit,
  resolveWorkflowDecision
} = require('./workflow-runtime.js');
const { listRunHistory, runHistoryDetail, inspectRunArtifact } = require('./run-history.js');
const {
  duplicateRunAsRecipe,
  edgesFromPlan,
  redactedValue,
  runCheckout,
  runNodeIo,
  studioAgentHandoff
} = require('./run-checkout.js');
const {
  appendRunAnswer,
  appendRunQuestion,
  listRunInteractions
} = require('./run-interactions.js');
const { saveGoalDraft, loadGoalDraft, freezeGoal, unfreezeGoal } = require('./goal-runtime.js');
const { appendRunLifecycle, listRunLifecycle, runAgentPresence } = require('./run-lifecycle.js');
const { runJourney } = require('./run-journey.js');
const { cancelStudioRun, createStudioRun, executeStudioRun } = require('./studio-runtime.js');
const { createHandoff, handoffBrief, recordDecision } = require('./handoff.js');
const { loadStudioLayout, saveStudioLayout } = require('./studio-layout.js');
const {
  SHIPPED_TYPES,
  detectAdapterHints,
  writeShippedAdapter
} = require('./generate-adapter.js');

const MAX_BODY = 256 * 1024;
const ASSET_DIR = path.join(__dirname, '..', 'studio');
const LIVE_WORKFLOW_EVENT_LIMIT = 12;

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function studioStructureError(added, removed, changed, message) {
  const error = new Error(message || 'Studio is read-only for workflow structure');
  error.code = 'STUDIO_STRUCTURE_READ_ONLY';
  error.added = added;
  error.removed = removed;
  error.changed = changed;
  error.details = { added, removed, changed };
  return error;
}

function structureNode(node) {
  const snapshot = { ...node };
  delete snapshot.dependsOn;
  delete snapshot.displayName;
  return snapshot;
}

function assertStudioStructureReadOnly(baseRecipe, candidate) {
  const baseNodes = new Map((baseRecipe.nodes || []).map((node) => [node.id, node]));
  const nextNodes = new Map((candidate.nodes || []).map((node) => [node.id, node]));
  const added = [...nextNodes.keys()].filter((id) => !baseNodes.has(id)).sort();
  const removed = [...baseNodes.keys()].filter((id) => !nextNodes.has(id)).sort();
  const changed = [];
  for (const [id, node] of nextNodes) {
    const base = baseNodes.get(id);
    if (!base) continue;
    if (canonicalJson(structureNode(base)) !== canonicalJson(structureNode(node))) changed.push(id);
  }
  if (canonicalJson(baseRecipe.loopGroups || []) !== canonicalJson(candidate.loopGroups || [])) {
    changed.push('loopGroups');
  }
  changed.sort();
  if (added.length || removed.length || changed.length) {
    throw studioStructureError(added, removed, changed);
  }
}

function loadStudioBaseRecipe(rootDir, baseRecipeId) {
  const id = String(baseRecipeId || '').trim();
  if (!id) {
    throw studioStructureError([], [], [], 'Studio install requires baseRecipeId of the loaded recipe');
  }
  try {
    return loadRecipe(rootDir, id).recipe;
  } catch {
    throw studioStructureError([], [], [], `Cannot load base recipe ${id}`);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      text += chunk;
      if (Buffer.byteLength(text) > MAX_BODY) request.destroy(new Error('Request body exceeds 256 KiB'));
    });
    request.on('end', () => {
      try { resolve(text ? JSON.parse(text) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function studioStatusPath(rootDir) {
  return path.join(rootDir, '.ai-engineering-loop', 'studio.json');
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolvedRoot(dir) {
  const absolute = path.resolve(dir);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function sameRoot(left, right) {
  try {
    const a = path.resolve(left);
    const b = path.resolve(right);
    if (a === b) return true;
    return resolvedRoot(a) === resolvedRoot(b);
  } catch {
    return false;
  }
}

function readStudioUrl(rootDir) {
  try {
    const filePath = studioStatusPath(rootDir);
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!stored || stored.schemaVersion !== 1 || !stored.url) return null;
    if (!pidAlive(stored.pid) || !sameRoot(stored.root, rootDir)) return null;
    return stored.url;
  } catch {
    return null;
  }
}

function writeStudioAdvertisement(rootDir, { url, port }) {
  ensurePrivateRuntimeIgnores(rootDir);
  const filePath = studioStatusPath(rootDir);
  const payload = {
    schemaVersion: 1,
    pid: process.pid,
    port,
    url,
    root: resolvedRoot(rootDir),
    startedAt: new Date().toISOString()
  };
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function clearStudioAdvertisement(rootDir) {
  const filePath = studioStatusPath(rootDir);
  try {
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (stored.pid !== process.pid) return;
    fs.unlinkSync(filePath);
  } catch {
    // Missing or unreadable advertisement is not fatal.
  }
}

function formatSse(event) {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function streamStudioEvents(watcher, request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const headerId = request.headers['last-event-id'];
  const after = Number(url.searchParams.get('after') ?? (headerId == null ? 0 : headerId));
  if (!Number.isSafeInteger(after) || after < 0) {
    json(response, 400, {
      ok: false,
      code: 'INVALID_EVENT_CURSOR',
      error: 'Event cursor is invalid'
    });
    return;
  }
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  });
  if (typeof response.flushHeaders === 'function') response.flushHeaders();
  try { request.socket.setNoDelay(true); } catch { /* already closed */ }
  const hello = watcher.hello();
  response.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);
  const replay = watcher.eventsAfter(after);
  if (replay.gap) {
    response.write(formatSse({
      type: 'resync',
      seq: hello.seq,
      runId: hello.currentRunId,
      at: new Date().toISOString(),
      payload: { reason: 'gap', ringStart: replay.ringStart, after }
    }));
  } else {
    for (const event of replay.events) response.write(formatSse(event));
  }
  const unsubscribe = watcher.subscribe((event) => {
    if (response.writableEnded) return;
    response.write(formatSse(event));
  });
  request.on('close', unsubscribe);
}

function liveSnapshot(rootDir, runId) {
  let current = null;
  try { current = getCurrentRun(rootDir); } catch { current = null; }
  const id = runId || current?.runId;
  if (!id) return null;
  let run;
  try {
    run = loadRun(rootDir, id);
  } catch {
    return null;
  }
  const artifacts = loadArtifactSummaries(rootDir, run.runId);
  let interactions = { pending: [] };
  try {
    interactions = listRunInteractions(rootDir, run.runId);
  } catch {
    interactions = { pending: [] };
  }
  const snapshot = {
    run,
    current: current?.runId === run.runId,
    workflowBound: Boolean(run.workflow),
    artifacts,
    presence: compactPresence(rootDir, run.runId),
    interactions: {
      pending: interactions.pending.map((question) => ({
        questionId: question.questionId,
        number: question.number,
        actor: question.actor,
        message: question.message
      }))
    },
    summary: {
      runId: run.runId,
      state: run.state,
      workflowBound: Boolean(run.workflow),
      details: {
        nodeIo: `/api/runs/${encodeURIComponent(run.runId)}/nodes/{nodeId}`,
        artifacts: `/api/runs/${encodeURIComponent(run.runId)}/artifacts?path={path}`,
        lifecycle: `/api/runs/${encodeURIComponent(run.runId)}/lifecycle?after={sequence}`
      }
    }
  };
  try {
    snapshot.budget = budgetStatus(rootDir, { runId: run.runId });
  } catch {
    snapshot.budget = { spentThisRun: 0, perRunTokenLimit: 0 };
  }
  try {
    snapshot.lifecycle = listRunLifecycle(rootDir, run.runId, { after: 0, limit: 100, latest: true });
  } catch {
    snapshot.lifecycle = { runId: run.runId, events: [], nextSequence: 0 };
  }
  if (!run.workflow) {
    try {
      snapshot.journey = runJourney(rootDir, run.runId);
    } catch {
      snapshot.journey = {
        runId: run.runId,
        current: 'UNKNOWN',
        pendingQuestions: interactions.pending.length,
        sources: { available: false },
        steps: []
      };
    }
    snapshot.plan = { nodes: [] };
    snapshot.nodes = {};
    snapshot.edges = [];
    snapshot.loopGroups = [];
    snapshot.events = [];
    return redactedValue(snapshot);
  }
  const workflow = workflowStatus(rootDir, { runId: run.runId });
  const eventTail = workflow.events.slice(-LIVE_WORKFLOW_EVENT_LIMIT);
  const edges = edgesFromPlan(workflow.plan, workflow.state);
  snapshot.plan = workflow.plan;
  snapshot.nodes = workflow.state.nodes;
  snapshot.edges = edges;
  snapshot.loopGroups = workflow.state.loopGroups;
  snapshot.summary.nodeCount = workflow.plan.nodes.length;
  snapshot.summary.edgeCount = edges.length;
  snapshot.summary.workflowEventCount = workflow.events.length;
  snapshot.summary.workflowEventLimit = LIVE_WORKFLOW_EVENT_LIMIT;
  snapshot.summary.eventsTruncated = workflow.events.length > eventTail.length;
  snapshot.events = eventTail.map(({ initialNodes, changes, ...event }) => ({
    ...event,
    changedNodes: (changes || []).map((change) => change.nodeId)
  }));
  try {
    snapshot.journey = runJourney(rootDir, run.runId, { workflowState: workflow.state });
  } catch {
    snapshot.journey = {
      runId: run.runId,
      current: 'UNKNOWN',
      pendingQuestions: interactions.pending.length,
      sources: { available: false },
      steps: []
    };
  }
  return redactedValue(snapshot);
}

function bootstrap(rootDir, options = {}) {
  const recipes = listRecipes(rootDir).map(({ id, source }) => ({ ...inspectRecipe(rootDir, id), source }));
  const adapterHints = detectAdapterHints(rootDir);
  const watcher = options.watcher;
  return {
    root: path.resolve(rootDir),
    watchMode: watcher?.mode || (options.watchMode || 'watch'),
    eventSeq: watcher?.seq || 0,
    currentRunId: (() => {
      try { return getCurrentRun(rootDir)?.runId || null; } catch { return null; }
    })(),
    recipes,
    nodeTypes: recipeCatalog(),
    adapters: {
      types: SHIPPED_TYPES,
      current: adapterHints.existingType || null,
      recommended: adapterHints.recommended,
      reason: adapterHints.reason,
      ciProvider: adapterHints.ciProvider
    },
    live: liveSnapshot(rootDir, options.runId)
  };
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function localHostname(hostHeader) {
  try {
    return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

// The SameSite cookie alone does not stop CSRF: every localhost port is the
// same site. Mutations need proof of same origin (exact Origin match) or the
// explicit token header, and a JSON body type, which a cross-origin form or
// simple fetch cannot send without a CORS preflight this server never grants.
function mutationRejection(request, hostHeader, token) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { status: 415, message: 'Studio mutations require content-type application/json' };
  }
  if (constantTimeEqual(request.headers['x-ael-studio-token'], token)) return null;
  const origin = request.headers.origin;
  if (origin && origin === `http://${hostHeader}`) return null;
  return { status: 403, message: 'Cross-origin Studio mutation rejected' };
}

function createStudioServer(rootDir, {
  token = crypto.randomBytes(24).toString('base64url'),
  watch,
  debounceMs,
  pollMs,
  ringSize
} = {}) {
  const watcher = createRunWatcher(rootDir, { watch, debounceMs, pollMs, ringSize });
  watcher.start();
  const sockets = new Set();
  const server = http.createServer(async (request, response) => {
    const hostHeader = String(request.headers.host || '');
    const host = localHostname(hostHeader);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      response.writeHead(403).end('Forbidden host');
      return;
    }
    const url = new URL(request.url, `http://${hostHeader}`);
    const cookieToken = String(request.headers.cookie || '').split(';').map((item) => item.trim())
      .find((item) => item.startsWith('ael_studio='))?.slice('ael_studio='.length);
    const supplied = request.headers['x-ael-studio-token'] || cookieToken;
    if (url.pathname === '/' && constantTimeEqual(url.searchParams.get('token'), token)) {
      response.writeHead(302, {
        location: '/',
        'set-cookie': `ael_studio=${token}; HttpOnly; SameSite=Strict; Path=/`,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      }).end();
      return;
    }
    if (!constantTimeEqual(supplied, token)) {
      response.writeHead(401).end('Studio session required');
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      const csrf = mutationRejection(request, hostHeader, token);
      if (csrf) {
        response.writeHead(csrf.status).end(csrf.message);
        return;
      }
    }
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    try {
      const scopedRun = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      const scopedArtifact = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
      const scopedExecute = url.pathname.match(/^\/api\/runs\/([^/]+)\/execute$/);
      const scopedCancel = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
      const scopedGoal = url.pathname.match(/^\/api\/runs\/([^/]+)\/goal$/);
      const scopedLifecycle = url.pathname.match(/^\/api\/runs\/([^/]+)\/lifecycle$/);
      const scopedLifecycleStream = url.pathname.match(/^\/api\/runs\/([^/]+)\/lifecycle\/stream$/);
      const scopedGoalFreeze = url.pathname.match(/^\/api\/runs\/([^/]+)\/goal\/freeze$/);
      const scopedGoalUnfreeze = url.pathname.match(/^\/api\/runs\/([^/]+)\/goal\/unfreeze$/);
      const scopedCheckout = url.pathname.match(/^\/api\/runs\/([^/]+)\/checkout$/);
      const scopedRunNode = url.pathname.match(/^\/api\/runs\/([^/]+)\/nodes\/([^/]+)$/);
      const scopedDecision = url.pathname.match(/^\/api\/runs\/([^/]+)\/nodes\/([^/]+)\/decision$/);
      const scopedLoopLimit = url.pathname.match(/^\/api\/runs\/([^/]+)\/loops\/([^/]+)\/limit$/);
      const scopedDuplicate = url.pathname.match(/^\/api\/runs\/([^/]+)\/duplicate$/);
      const scopedAgentHandoff = url.pathname.match(/^\/api\/runs\/([^/]+)\/agent-handoff$/);
      const scopedInteractions = url.pathname.match(/^\/api\/runs\/([^/]+)\/interactions$/);
      const scopedQuestions = url.pathname.match(/^\/api\/runs\/([^/]+)\/questions$/);
      const scopedAnswer = url.pathname.match(/^\/api\/runs\/([^/]+)\/questions\/([^/]+)\/answer$/);
      if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
        json(response, 200, { ok: true, ...bootstrap(rootDir, { watcher }) });
      } else if (request.method === 'GET' && url.pathname === '/api/events') {
        streamStudioEvents(watcher, request, response);
      } else if (request.method === 'GET' && url.pathname === '/api/live') {
        json(response, 200, {
          ok: true,
          live: liveSnapshot(rootDir, url.searchParams.get('runId') || undefined)
        });
      } else if (request.method === 'GET' && url.pathname === '/api/runs') {
        json(response, 200, {
          ok: true,
          ...listRunHistory(rootDir, {
            query: url.searchParams.get('q') || '',
            status: url.searchParams.get('status') || undefined,
            mode: url.searchParams.get('mode') || undefined,
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined
          })
        });
      } else if (request.method === 'GET' && scopedRun) {
        json(response, 200, {
          ok: true,
          run: runHistoryDetail(rootDir, decodeURIComponent(scopedRun[1]))
        });
      } else if (request.method === 'GET' && scopedArtifact) {
        json(response, 200, {
          ok: true,
          artifact: inspectRunArtifact(
            rootDir,
            decodeURIComponent(scopedArtifact[1]),
            url.searchParams.get('path')
          )
        });
      } else if (request.method === 'GET' && scopedCheckout) {
        json(response, 200, {
          ok: true,
          checkout: runCheckout(rootDir, decodeURIComponent(scopedCheckout[1]))
        });
      } else if (request.method === 'POST' && scopedDecision) {
        const body = await readBody(request);
        const workflow = resolveWorkflowDecision(
          rootDir,
          decodeURIComponent(scopedDecision[2]),
          {
            runId: decodeURIComponent(scopedDecision[1]),
            outcome: body.outcome,
            actor: body.actor || 'studio-user'
          }
        );
        json(response, 200, { ok: true, nodes: workflow.state.nodes, loopGroups: workflow.state.loopGroups });
      } else if (request.method === 'POST' && scopedLoopLimit) {
        const body = await readBody(request);
        const workflow = resolveLoopLimit(
          rootDir,
          decodeURIComponent(scopedLoopLimit[2]),
          {
            runId: decodeURIComponent(scopedLoopLimit[1]),
            action: body.action,
            expectedIteration: body.expectedIteration,
            actor: body.actor || 'studio-user',
            reason: body.reason
          }
        );
        json(response, 200, { ok: true, nodes: workflow.state.nodes, loopGroups: workflow.state.loopGroups });
      } else if (request.method === 'GET' && scopedRunNode) {
        json(response, 200, {
          ok: true,
          io: runNodeIo(
            rootDir,
            decodeURIComponent(scopedRunNode[1]),
            decodeURIComponent(scopedRunNode[2])
          )
        });
      } else if (request.method === 'POST' && scopedDuplicate) {
        const body = await readBody(request);
        json(response, 200, {
          ok: true,
          preview: duplicateRunAsRecipe(rootDir, decodeURIComponent(scopedDuplicate[1]), body)
        });
      } else if (request.method === 'GET' && scopedAgentHandoff) {
        json(response, 200, {
          ok: true,
          handoff: studioAgentHandoff(rootDir, decodeURIComponent(scopedAgentHandoff[1]))
        });
      } else if (request.method === 'GET' && scopedInteractions) {
        json(response, 200, {
          ok: true,
          interactions: listRunInteractions(rootDir, decodeURIComponent(scopedInteractions[1]))
        });
      } else if (scopedLifecycleStream || url.pathname.startsWith('/api/import/')) {
        json(response, 404, {
          ok: false,
          code: 'GONE',
          error: url.pathname.startsWith('/api/import/')
            ? 'Workflow import was removed from Studio. Author recipes as files and install them with the recipe CLI.'
            : 'Per-run lifecycle streams were replaced by GET /api/events'
        });
      } else if (request.method === 'GET' && scopedLifecycle) {
        const runId = decodeURIComponent(scopedLifecycle[1]);
        json(response, 200, {
          ok: true,
          lifecycle: listRunLifecycle(rootDir, runId, {
            after: Number(url.searchParams.get('after') || 0),
            limit: Number(url.searchParams.get('limit') || 100)
          }),
          presence: runAgentPresence(rootDir, runId)
        });
      } else if (request.method === 'POST' && scopedQuestions) {
        const body = await readBody(request);
        json(response, 201, {
          ok: true,
          question: appendRunQuestion(rootDir, decodeURIComponent(scopedQuestions[1]), body)
        });
      } else if (request.method === 'POST' && scopedAnswer) {
        const body = await readBody(request);
        json(response, 201, {
          ok: true,
          answer: appendRunAnswer(
            rootDir,
            decodeURIComponent(scopedAnswer[1]),
            decodeURIComponent(scopedAnswer[2]),
            body
          )
        });
      } else if (request.method === 'POST' && scopedExecute) {
        const result = executeStudioRun(rootDir, decodeURIComponent(scopedExecute[1]));
        json(response, 200, {
          ok: true,
          runId: result.workflow.run.runId,
          execution: {
            dispatch: 'LOCAL_RUNTIME_ONLY',
            externalDispatch: false,
            triggerNodeId: result.workflow.events.at(-1).triggerNodeId
          },
          nodes: result.workflow.state.nodes,
          budget: result.budget
        });
      } else if (request.method === 'GET' && scopedGoal) {
        json(response, 200, {
          ok: true,
          draft: loadGoalDraft(rootDir, decodeURIComponent(scopedGoal[1]))
        });
      } else if (request.method === 'PUT' && scopedGoal) {
        const body = await readBody(request);
        const runId = decodeURIComponent(scopedGoal[1]);
        const actor = body.actor || 'studio-user';
        listRunLifecycle(rootDir, runId);
        const draft = saveGoalDraft(rootDir, runId, body.goal, {
          actor,
          expectedRevision: body.expectedRevision
        });
        appendRunLifecycle(rootDir, runId, {
          type: 'GOAL_DRAFT_UPDATED',
          phase: 'goal',
          actor,
          message: `Goal draft revision ${draft.metadata.revision} was saved in Studio`
        });
        appendRunLifecycle(rootDir, runId, {
          type: 'GOAL_READY',
          phase: 'goal',
          actor,
          message: `Goal draft revision ${draft.metadata.revision} is ready for review`
        });
        json(response, 200, { ok: true, draft, frozen: false });
      } else if (request.method === 'POST' && scopedGoalFreeze) {
        const body = await readBody(request);
        const runId = decodeURIComponent(scopedGoalFreeze[1]);
        listRunLifecycle(rootDir, runId);
        const run = freezeGoal(rootDir, runId, {
          actor: body.actor,
          expectedRevision: body.expectedRevision,
          expectedHash: body.expectedHash
        });
        appendRunLifecycle(rootDir, runId, {
          type: 'GOAL_FROZEN',
          phase: 'goal',
          actor: body.actor || 'studio-user',
          message: 'Goal Contract frozen in Studio'
        });
        json(response, 200, { ok: true, run });
      } else if (request.method === 'POST' && scopedGoalUnfreeze) {
        const body = await readBody(request);
        const run = unfreezeGoal(rootDir, decodeURIComponent(scopedGoalUnfreeze[1]), {
          actor: body.actor,
          reason: body.reason
        });
        json(response, 200, { ok: true, run });
      } else if (request.method === 'GET' && url.pathname === '/api/run') {
        json(response, 200, { ok: true, run: runHistoryDetail(rootDir, url.searchParams.get('runId')) });
      } else if (request.method === 'GET' && url.pathname === '/api/run/artifact') {
        json(response, 200, {
          ok: true,
          artifact: inspectRunArtifact(
            rootDir,
            url.searchParams.get('runId'),
            url.searchParams.get('path')
          )
        });
      } else if (request.method === 'POST' && ['/api/runs', '/api/run/create'].includes(url.pathname)) {
        const body = await readBody(request);
        const run = createStudioRun(rootDir, body);
        json(response, 201, { ok: true, run });
      } else if (request.method === 'POST' && scopedCancel) {
        const body = await readBody(request);
        const run = cancelStudioRun(rootDir, decodeURIComponent(scopedCancel[1]), {
          actor: body.actor || 'human',
          reason: body.reason || 'Replaced by a new Goal'
        });
        json(response, 200, { ok: true, run });
      } else if (request.method === 'PATCH' && url.pathname === '/api/run/name') {
        const body = await readBody(request);
        const run = updateRunDisplayName(rootDir, body.runId, body.displayName, {
          actor: body.actor || 'human'
        });
        json(response, 200, { ok: true, run });
      } else if (request.method === 'PUT' && ['/api/goal', '/api/goal/save'].includes(url.pathname)) {
        const body = await readBody(request);
        const goal = saveGoalDraft(rootDir, body.runId, body.goal);
        json(response, 200, { ok: true, goal, frozen: false });
      } else if (request.method === 'POST' && url.pathname === '/api/goal/freeze') {
        const body = await readBody(request);
        const run = freezeGoal(rootDir, body.runId, { actor: body.actor });
        json(response, 200, { ok: true, run });
      } else if (request.method === 'POST' && url.pathname === '/api/goal/unfreeze') {
        const body = await readBody(request);
        const run = unfreezeGoal(rootDir, body.runId, {
          actor: body.actor,
          reason: body.reason
        });
        json(response, 200, { ok: true, run });
      } else if (request.method === 'POST' && ['/api/run/execute', '/api/execute'].includes(url.pathname)) {
        const body = await readBody(request);
        const result = executeStudioRun(rootDir, body.runId);
        json(response, 200, {
          ok: true,
          runId: result.workflow.run.runId,
          execution: {
            dispatch: 'LOCAL_RUNTIME_ONLY',
            externalDispatch: false,
            triggerNodeId: result.workflow.events.at(-1).triggerNodeId
          },
          nodes: result.workflow.state.nodes,
          budget: result.budget
        });
      } else if (request.method === 'GET' && url.pathname === '/api/recipe') {
        const loaded = loadRecipe(rootDir, url.searchParams.get('id'));
        json(response, 200, { ok: true, source: loaded.source, recipe: loaded.recipe });
      } else if (request.method === 'GET' && url.pathname === '/api/layout') {
        const loaded = loadRecipe(rootDir, url.searchParams.get('id'));
        const nodeIds = loaded.recipe.nodes.map((node) => node.id);
        json(response, 200, {
          ok: true,
          layout: loadStudioLayout(rootDir, loaded.recipe.id, { nodeIds })
        });
      } else if (request.method === 'PUT' && url.pathname === '/api/layout') {
        const body = await readBody(request);
        const loaded = loadRecipe(rootDir, body.recipeId);
        const nodeIds = loaded.recipe.nodes.map((node) => node.id);
        const layout = saveStudioLayout(rootDir, loaded.recipe.id, body.layout, { nodeIds });
        json(response, 200, { ok: true, layout });
      } else if (request.method === 'POST' && url.pathname === '/api/adapter/select') {
        const body = await readBody(request);
        if (!SHIPPED_TYPES.includes(body.type)) {
          const error = new Error(`Unknown adapter type: ${body.type || '(empty)'}`);
          error.code = 'UNKNOWN_ADAPTER';
          throw error;
        }
        const hints = detectAdapterHints(rootDir);
        const file = writeShippedAdapter(rootDir, { type: body.type, hints });
        json(response, 200, {
          ok: true,
          adapter: { type: body.type, file: path.relative(rootDir, file), ciProvider: hints.ciProvider }
        });
      } else if (request.method === 'POST' && url.pathname === '/api/validate') {
        const body = await readBody(request);
        if (body.baseRecipeId) {
          assertStudioStructureReadOnly(loadStudioBaseRecipe(rootDir, body.baseRecipeId), body.recipe);
        }
        const validation = validateRecipe(body.recipe, body.mode ? { mode: body.mode } : {});
        json(response, validation.valid ? 200 : 422, {
          ok: validation.valid,
          validation,
          plans: validation.valid
            ? (body.mode ? [body.mode] : body.recipe.compatibleModes).map((mode) => compileRecipe(body.recipe, { mode }))
            : []
        });
      } else if (request.method === 'POST' && url.pathname === '/api/install') {
        const body = await readBody(request);
        assertStudioStructureReadOnly(loadStudioBaseRecipe(rootDir, body.baseRecipeId), body.recipe);
        const drafts = path.join(rootDir, '.ai-engineering-loop', 'drafts');
        fs.mkdirSync(drafts, { recursive: true, mode: 0o700 });
        const candidate = path.join(drafts, `${crypto.randomUUID()}.json`);
        fs.writeFileSync(candidate, JSON.stringify(body.recipe), { mode: 0o600 });
        try {
          const result = installRecipe(rootDir, path.relative(rootDir, candidate), { replace: body.replace === true });
          if (body.layout) {
            saveStudioLayout(rootDir, result.recipe.id, body.layout, {
              nodeIds: result.recipe.nodes.map((node) => node.id)
            });
          }
          json(response, 200, { ok: true, id: result.recipe.id, version: result.recipe.version, sourceHash: result.sourceHash });
        } finally {
          try { fs.unlinkSync(candidate); } catch {}
        }
      } else if (request.method === 'GET' && url.pathname === '/api/handoff') {
        const bundle = createHandoff(rootDir, { audience: url.searchParams.get('audience') || 'developer' });
        json(response, 200, { ok: true, bundle, brief: handoffBrief(bundle) });
      } else if (request.method === 'POST' && url.pathname === '/api/node/approve') {
        const body = await readBody(request);
        approveWorkflowNode(rootDir, body.nodeId, { runId: body.runId, approvedBy: body.approvedBy || 'human' });
        json(response, 200, { ok: true });
      } else if (request.method === 'POST' && url.pathname === '/api/node/start') {
        const body = await readBody(request);
        startWorkflowNode(rootDir, body.nodeId, { runId: body.runId });
        json(response, 200, { ok: true });
      } else if (request.method === 'POST' && url.pathname === '/api/node/complete') {
        const body = await readBody(request);
        completeWorkflowNode(rootDir, body.nodeId, { runId: body.runId, artifact: body.artifact });
        json(response, 200, { ok: true });
      } else if (request.method === 'POST' && url.pathname === '/api/node/fail') {
        const body = await readBody(request);
        failWorkflowNode(rootDir, body.nodeId, { runId: body.runId, reason: body.reason });
        json(response, 200, { ok: true });
      } else if (request.method === 'POST' && url.pathname === '/api/node/retry') {
        const body = await readBody(request);
        retryWorkflowNode(rootDir, body.nodeId, { runId: body.runId });
        json(response, 200, { ok: true });
      } else if (request.method === 'POST' && url.pathname === '/api/node/activity') {
        const body = await readBody(request);
        recordWorkflowActivity(rootDir, body.nodeId, {
          runId: body.runId,
          message: body.message
        });
        json(response, 200, { ok: true });
      } else if (request.method === 'POST' && url.pathname === '/api/decision') {
        const body = await readBody(request);
        const result = recordDecision(rootDir, {
          runId: body.runId,
          summary: body.summary,
          rationale: body.rationale,
          consequences: body.consequences
        });
        json(response, 200, { ok: true, ...result });
      } else {
        const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!['index.html', 'app.js', 'styles.css'].includes(asset)) {
          response.writeHead(404).end('Not found');
          return;
        }
        const types = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
        response.writeHead(200, {
          'content-type': `${types[asset.split('.').at(-1)]}; charset=utf-8`,
          'cache-control': 'no-store'
        });
        response.end(fs.readFileSync(path.join(ASSET_DIR, asset)));
      }
    } catch (error) {
      json(response, 400, {
        ok: false,
        code: error.code || 'STUDIO_ERROR',
        error: error.message,
        details: error.details || [],
        ...(error.added ? { added: error.added, removed: error.removed, changed: error.changed } : {}),
        ...(error.activeRun ? { activeRun: error.activeRun } : {})
      });
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const listen = server.listen.bind(server);
  server.listen = (...listenArgs) => {
    const advertise = () => {
      const address = server.address();
      if (!address || typeof address.port !== 'number') return;
      writeStudioAdvertisement(rootDir, {
        url: `http://127.0.0.1:${address.port}`,
        port: address.port
      });
    };
    const last = listenArgs[listenArgs.length - 1];
    const callback = typeof last === 'function' ? listenArgs.pop() : null;
    listenArgs.push(() => {
      advertise();
      if (callback) callback();
    });
    return listen(...listenArgs);
  };
  const close = server.close.bind(server);
  server.close = (callback) => {
    watcher.stop();
    clearStudioAdvertisement(rootDir);
    for (const socket of sockets) {
      try { socket.destroy(); } catch { /* already closed */ }
    }
    sockets.clear();
    return close(callback);
  };
  return { server, token, watcher };
}

module.exports = { createStudioServer, bootstrap, liveSnapshot, readStudioUrl };
