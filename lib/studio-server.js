'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { URL, URLSearchParams } = require('url');
const { freezeGoal, humanFreezeActor } = require('./goal-runtime.js');
const { assertRunId } = require('./run-state.js');
const { closeFreezeQuestions } = require('./run-interactions.js');
const { homeDir, readUserConfig, writeUserConfig } = require('./user-state.js');
const { discoverProjects, resolveRoot, contextPath } = require('./studio/projects.js');
const { summarizeProject, runDetail, runHistory, goalDiagram } = require('./studio/summary.js');
const { VIEWS } = require('./flow.js');
const { createWaitTracker } = require('./studio/notify.js');
const { studioDiners } = require('./studio/diners.js');

const MAX_BODY = 16 * 1024;

function goalNodeOf(root, runId) {
  try {
    const { loadWorkflow } = require('./workflow-runtime.js');
    return loadWorkflow(root, runId).plan.nodes.find((node) => node.legacyGate === 'goal') || null;
  } catch {
    return null;
  }
}

function recordStudioFreeze(root, runId, actor) {
  const goalNode = goalNodeOf(root, runId);
  try {
    require('./run-lifecycle.js').appendRunLifecycle(root, runId, {
      type: goalNode ? 'NODE_COMPLETED' : 'GOAL_FROZEN',
      ...(goalNode ? { nodeId: goalNode.id } : {}),
      phase: 'goal',
      actor,
      message: 'Goal Contract frozen in Studio'
    });
  } catch {}
  try {
    const impactMap = require('./impact-map.js');
    if (!impactMap.loadImpactMap(root, runId)) impactMap.generateImpactMap(root, { runId });
  } catch {}
}
const PING_MS = 15_000;
const ASSET_DIR = path.join(__dirname, '..', 'studio');
const STATIC_ASSETS = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/tokens.css', 'tokens.css'],
  ['/styles.css', 'styles.css'],
  ['/diners.json', 'diners.json'],
  ['/js/main.js', 'js/main.js'],
  ['/js/api.js', 'js/api.js'],
  ['/js/list.js', 'js/list.js'],
  ['/js/orders.js', 'js/orders.js'],
  ['/js/workstation.js', 'js/workstation.js'],
  ['/js/detail.js', 'js/detail.js'],
  ['/js/markdown.js', 'js/markdown.js'],
  ['/js/sheet.js', 'js/sheet.js'],
  ['/js/bot.js', 'js/bot.js'],
  ['/js/mood.js', 'js/mood.js'],
  ['/js/kitchen.js', 'js/kitchen.js'],
  ['/js/forms.js', 'js/forms.js'],
  ['/js/stations.js', 'js/stations.js'],
  ['/js/diners.js', 'js/diners.js'],
  ['/js/carriers.js', 'js/carriers.js'],
  ['/js/restaurant.js', 'js/restaurant.js'],
  ['/js/ring2d.js', 'js/ring2d.js'],
  ['/vendor/three.module.min.js', 'vendor/three.module.min.js'],
  ['/vendor/three.core.min.js', 'vendor/three.core.min.js']
]);
const CONTENT_TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const DIAGRAM_POLICY = ["default-src 'none'", "img-src data:", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'", 'sandbox'];
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const STATUS_BY_CODE = {
  NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  GOAL_DIAGRAM_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  PATH_OUTSIDE_SCOPE: 403,
  GOAL_FREEZE_NOT_HUMAN: 403,
  GOAL_DRAFT_CONFLICT: 409,
  BODY_TOO_LARGE: 413
};

function studioError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function pathSegment(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw studioError('INVALID_PATH', 'Request path is not valid percent-encoding');
  }
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function sendError(response, error) {
  const code = error.code || 'STUDIO_ERROR';
  json(response, STATUS_BY_CODE[code] || (error.code ? 400 : 500), {
    ok: false,
    code,
    error: error.message,
    ...(error.why ? { why: error.why } : {}),
    ...(error.fix ? { fix: error.fix } : {})
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      text += chunk;
      if (Buffer.byteLength(text) > MAX_BODY) {
        reject(studioError('BODY_TOO_LARGE', 'Request body exceeds 16 KiB'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        const value = text ? JSON.parse(text) : {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        resolve(value);
      } catch {
        reject(studioError('INVALID_JSON', 'Request body must be a JSON object'));
      }
    });
    request.on('error', reject);
  });
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

function requestUrl(request, hostHeader) {
  try {
    return new URL(request.url, `http://${hostHeader}`);
  } catch {
    return null;
  }
}

function sessionCookie(request) {
  return String(request.headers.cookie || '').split(';').map((item) => item.trim())
    .find((item) => item.startsWith('ael_studio='))?.slice('ael_studio='.length);
}

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

function gitUserName(home) {
  try {
    return execFileSync('git', ['config', '--global', 'user.name'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000
    }).trim();
  } catch {
    return '';
  }
}

function osUserName() {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

function isHumanActor(actor) {
  try {
    humanFreezeActor(actor, 'studio');
    return true;
  } catch {
    return false;
  }
}

function answerFreezeQuestions(root, runId, actor) {
  try {
    closeFreezeQuestions(root, runId, actor);
  } catch {
    return;
  }
}

function diagramPolicy(html) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((match) => `'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`);
  return [...DIAGRAM_POLICY.slice(0, 1), `style-src ${styles.length ? styles.join(' ') : "'none'"}`, ...DIAGRAM_POLICY.slice(1)].join('; ');
}

const DIAGRAM_CACHE = 'private, max-age=3600, immutable';

function sendDiagram(response, html, { cacheable = false } = {}) {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': cacheable ? DIAGRAM_CACHE : 'no-store',
    'content-security-policy': diagramPolicy(html),
    'cross-origin-resource-policy': 'same-origin'
  });
  response.end(html);
}

const ASSET_CACHE = new Map();
const COMPRESS_MIN = 1024;
const BROTLI = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } };

function loadAsset(asset) {
  const file = path.join(ASSET_DIR, asset);
  const stat = fs.statSync(file);
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const cached = ASSET_CACHE.get(asset);
  if (cached && cached.stamp === stamp) return cached;
  const body = fs.readFileSync(file);
  const entry = {
    stamp,
    body,
    etag: `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
    type: `${CONTENT_TYPES[asset.split('.').at(-1)]}; charset=utf-8`,
    encoded: new Map()
  };
  ASSET_CACHE.set(asset, entry);
  return entry;
}

function preferredEncoding(request, size) {
  if (size < COMPRESS_MIN) return null;
  const accepted = String(request.headers['accept-encoding'] || '').toLowerCase();
  if (/\bbr\b/.test(accepted)) return 'br';
  if (/\bgzip\b/.test(accepted)) return 'gzip';
  return null;
}

function encodedBody(entry, encoding) {
  if (!encoding) return entry.body;
  if (!entry.encoded.has(encoding)) {
    entry.encoded.set(encoding, encoding === 'br' ? zlib.brotliCompressSync(entry.body, BROTLI) : zlib.gzipSync(entry.body, { level: 9 }));
  }
  return entry.encoded.get(encoding);
}

function etagMatches(header, etag) {
  return String(header || '').split(',').some((value) => {
    const tag = value.trim();
    return tag === '*' || tag.replace(/^W\//, '') === etag;
  });
}

function serveAsset(request, response, pathname) {
  const asset = STATIC_ASSETS.get(pathname);
  let entry;
  try {
    entry = asset && loadAsset(asset);
  } catch {
    entry = null;
  }
  if (!entry) {
    response.writeHead(404, { 'cache-control': 'no-store' }).end('Not found');
    return;
  }
  const headers = { 'cache-control': 'no-cache', etag: entry.etag, vary: 'accept-encoding' };
  if (etagMatches(request.headers['if-none-match'], entry.etag)) {
    response.writeHead(304, headers).end();
    return;
  }
  const encoding = preferredEncoding(request, entry.body.length);
  const body = encodedBody(entry, encoding);
  response.writeHead(200, {
    ...headers,
    'content-type': entry.type,
    'content-length': body.length,
    ...(encoding ? { 'content-encoding': encoding } : {})
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

function loginRedirect(url) {
  const rest = new URLSearchParams(url.searchParams);
  rest.delete('token');
  const query = rest.toString();
  return query ? `/?${query}` : '/';
}

function changeSignature(summaries) {
  return JSON.stringify(summaries, (key, value) => (key === 'elapsedMs' ? undefined : value));
}

function createStudioServer({
  home = homeDir(),
  token = crypto.randomBytes(24).toString('base64url'),
  notifier,
  pollMs = 2000
} = {}) {
  const waits = createWaitTracker({ notify: notifier || (() => {}) });
  const streams = new Set();
  const sockets = new Set();
  let latest = [];
  let signature = null;

  function summarizeAll() {
    const now = Date.now();
    return discoverProjects({ home }).map((project) => summarizeProject(project, { now }));
  }

  function writeProjects(stream) {
    stream.write(`event: projects\ndata: ${JSON.stringify({ projects: latest })}\n\n`);
  }

  function poll() {
    try {
      latest = summarizeAll();
    } catch {
      return;
    }
    const next = changeSignature(latest);
    if (next !== signature) {
      signature = next;
      for (const stream of streams) writeProjects(stream);
    }
    try {
      waits.update(latest);
    } catch {
      return;
    }
  }

  function ping() {
    for (const stream of streams) stream.write('event: ping\ndata: {}\n\n');
  }

  function currentActor() {
    const configured = readUserConfig(home).studioActor;
    if (typeof configured === 'string' && configured.trim()) return configured.trim();
    return gitUserName(home) || osUserName();
  }

  function targetFor(encodedId) {
    const target = resolveRoot(discoverProjects({ home }), pathSegment(encodedId));
    if (!target || target.project.missing) throw studioError('PROJECT_NOT_FOUND', 'Studio does not know this project');
    return target;
  }

  function existingRunId(target, encodedRunId) {
    const runId = assertRunId(pathSegment(encodedRunId));
    if (!fs.existsSync(contextPath(target.root, 'runs', runId, 'state.json'))) {
      throw studioError('RUN_NOT_FOUND', `Run ${runId} does not exist in this project`);
    }
    return runId;
  }

  function openEventStream(request, response) {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    if (typeof response.flushHeaders === 'function') response.flushHeaders();
    streams.add(response);
    writeProjects(response);
    request.on('close', () => streams.delete(response));
  }

  async function route(request, response, url) {
    const method = request.method;
    const pathname = url.pathname;
    if (pathname === '/api/projects') {
      if (method !== 'GET') throw studioError('METHOD_NOT_ALLOWED', 'Use GET');
      json(response, 200, { ok: true, projects: summarizeAll() });
      return;
    }
    if (pathname === '/api/events') {
      if (method !== 'GET') throw studioError('METHOD_NOT_ALLOWED', 'Use GET');
      openEventStream(request, response);
      return;
    }
    if (pathname === '/api/me') {
      if (method === 'GET') {
        const actor = currentActor();
        json(response, 200, { ok: true, actor, actorValid: isHumanActor(actor), ...studioDiners(readUserConfig(home)) });
        return;
      }
      if (method !== 'PUT') throw studioError('METHOD_NOT_ALLOWED', 'Use GET or PUT');
      const body = await readBody(request);
      const actor = humanFreezeActor(body.actor, 'studio');
      writeUserConfig({ studioActor: actor }, home);
      json(response, 200, { ok: true, actor, actorValid: true, ...studioDiners(readUserConfig(home)) });
      return;
    }
    const freeze = pathname.match(/^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/goal\/freeze$/);
    if (freeze) {
      if (method !== 'POST') throw studioError('METHOD_NOT_ALLOWED', 'Use POST');
      const body = await readBody(request);
      if (typeof body.expectedHash !== 'string' || !body.expectedHash) {
        throw studioError('EXPECTED_HASH_REQUIRED', 'Freeze needs the expectedHash of the Goal draft you reviewed');
      }
      const target = targetFor(freeze[1]);
      const runId = existingRunId(target, freeze[2]);
      const actor = currentActor();
      const { alreadyFrozen = false, ...run } = freezeGoal(target.root, runId, {
        actor,
        expectedHash: body.expectedHash,
        studioSession: true
      });
      const human = humanFreezeActor(actor, runId);
      if (!alreadyFrozen) recordStudioFreeze(target.root, runId, human);
      answerFreezeQuestions(target.root, runId, human);
      json(response, 200, { ok: true, run, alreadyFrozen });
      return;
    }
    const diagram = pathname.match(/^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/goal\/diagram$/);
    if (diagram) {
      if (method !== 'GET') throw studioError('METHOD_NOT_ALLOWED', 'Use GET');
      const view = url.searchParams.get('view');
      if (!VIEWS.includes(view)) throw studioError('INVALID_VIEW', 'Unknown diagram view: use state, storyboard or lanes');
      const target = targetFor(diagram[1]);
      const runId = existingRunId(target, diagram[2]);
      const result = goalDiagram(target, runId, view);
      if (!result.html) throw studioError('GOAL_DIAGRAM_NOT_FOUND', result.missing);
      const rev = url.searchParams.get('rev');
      sendDiagram(response, result.html, { cacheable: Boolean(rev && result.hash && rev === result.hash) });
      return;
    }
    const history = pathname.match(/^\/api\/projects\/([^/]+)\/runs$/);
    if (history) {
      if (method !== 'GET') throw studioError('METHOD_NOT_ALLOWED', 'Use GET');
      json(response, 200, { ok: true, runs: runHistory(targetFor(history[1]), { now: Date.now() }) });
      return;
    }
    const detail = pathname.match(/^\/api\/projects\/([^/]+)\/runs\/([^/]+)$/);
    if (detail) {
      if (method !== 'GET') throw studioError('METHOD_NOT_ALLOWED', 'Use GET');
      const target = targetFor(detail[1]);
      const runId = existingRunId(target, detail[2]);
      json(response, 200, { ok: true, detail: runDetail(target, runId, { now: Date.now() }) });
      return;
    }
    if (pathname.startsWith('/api/')) throw studioError('NOT_FOUND', 'Unknown Studio endpoint');
    if (!['GET', 'HEAD'].includes(method)) throw studioError('METHOD_NOT_ALLOWED', 'Use GET');
    serveAsset(request, response, pathname);
  }

  const server = http.createServer(async (request, response) => {
    const hostHeader = String(request.headers.host || '');
    if (!LOCAL_HOSTS.has(localHostname(hostHeader))) {
      response.writeHead(403).end('Forbidden host');
      return;
    }
    const url = requestUrl(request, hostHeader);
    if (!url) {
      response.writeHead(400, { 'cache-control': 'no-store' }).end('Bad request');
      return;
    }
    if (url.pathname === '/healthz' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ app: 'ael-studio', pid: process.pid }));
      return;
    }
    if (url.pathname === '/' && constantTimeEqual(url.searchParams.get('token'), token)) {
      response.writeHead(302, {
        location: loginRedirect(url),
        'set-cookie': `ael_studio=${token}; HttpOnly; SameSite=Strict; Path=/`,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer'
      }).end();
      return;
    }
    if (!constantTimeEqual(request.headers['x-ael-studio-token'] || sessionCookie(request), token)) {
      response.writeHead(401).end('Studio session required');
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      const rejection = mutationRejection(request, hostHeader, token);
      if (rejection) {
        response.writeHead(rejection.status).end(rejection.message);
        return;
      }
    }
    response.setHeader('content-security-policy', CONTENT_SECURITY_POLICY);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    try {
      await route(request, response, url);
    } catch (error) {
      if (!response.headersSent) sendError(response, error);
      else response.end();
    }
  });

  poll();
  const pollTimer = setInterval(poll, pollMs);
  const pingTimer = setInterval(ping, PING_MS);
  pollTimer.unref();
  pingTimer.unref();

  function stopTimers() {
    clearInterval(pollTimer);
    clearInterval(pingTimer);
  }

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('close', stopTimers);

  function close() {
    stopTimers();
    for (const stream of streams) stream.end();
    streams.clear();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    return new Promise((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }

  return { server, token, close };
}

module.exports = { createStudioServer };
