'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const { listRecipes, loadRecipe, validateRecipe, compileRecipe } = require('./recipe.js');
const { inspectRecipe, installRecipe, recipeCatalog } = require('./recipe-builder.js');
const { getCurrentRun } = require('./run-state.js');
const { budgetStatus } = require('./budget.js');
const {
  workflowStatus,
  approveWorkflowNode,
  retryWorkflowNode,
  recordWorkflowActivity
} = require('./workflow-runtime.js');
const { createHandoff, handoffBrief, recordDecision } = require('./handoff.js');
const { loadStudioLayout, saveStudioLayout } = require('./studio-layout.js');
const {
  SHIPPED_TYPES,
  detectAdapterHints,
  writeShippedAdapter
} = require('./generate-adapter.js');

const MAX_BODY = 256 * 1024;
const ASSET_DIR = path.join(__dirname, '..', 'studio');

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
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

function liveSnapshot(rootDir) {
  const run = getCurrentRun(rootDir);
  if (!run?.workflow) return null;
  const workflow = workflowStatus(rootDir, { runId: run.runId });
  return {
    run,
    plan: workflow.plan,
    nodes: workflow.state.nodes,
    budget: budgetStatus(rootDir, { runId: run.runId }),
    events: workflow.events.slice(-50).map(({ initialNodes, changes, ...event }) => ({
      ...event,
      changedNodes: (changes || []).map((change) => change.nodeId)
    }))
  };
}

function bootstrap(rootDir) {
  const recipes = listRecipes(rootDir).map(({ id, source }) => ({ ...inspectRecipe(rootDir, id), source }));
  const adapterHints = detectAdapterHints(rootDir);
  return {
    recipes,
    nodeTypes: recipeCatalog(),
    adapters: {
      types: SHIPPED_TYPES,
      current: adapterHints.existingType || null,
      recommended: adapterHints.recommended,
      ciProvider: adapterHints.ciProvider
    },
    live: liveSnapshot(rootDir)
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

function createStudioServer(rootDir, { token = crypto.randomBytes(24).toString('base64url') } = {}) {
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
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    try {
      if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
        json(response, 200, { ok: true, ...bootstrap(rootDir) });
      } else if (request.method === 'GET' && url.pathname === '/api/live') {
        json(response, 200, { ok: true, live: liveSnapshot(rootDir) });
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
      json(response, 400, { ok: false, code: error.code || 'STUDIO_ERROR', error: error.message, details: error.details || [] });
    }
  });
  return { server, token };
}

module.exports = { createStudioServer, bootstrap, liveSnapshot };
