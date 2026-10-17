'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createStudioServer } = require('../lib/studio-server.js');

class ClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }
}

class ElementMock {
  constructor(id = '') {
    this.id = id;
    this.style = {};
    this.classList = new ClassList();
    this.dataset = {};
    this.value = id === 'recipe' ? 'default' : '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.selectedOptions = [];
    this.files = [];
    this.open = false;
    this.listeners = {};
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }
  setAttribute() {}
  append() {}
  insertAdjacentHTML(_position, value) { this.innerHTML += value; }
  remove() {}
  setPointerCapture() {}
  focus() {}
  select() {}
  blur() { this.onblur?.({ currentTarget: this }); }
  showModal() { this.open = true; }
  close() {
    this.open = false;
    for (const listener of this.listeners.close || []) listener({ currentTarget: this });
  }
  contains(value) { return value === this; }
  matches() { return false; }
  closest() { return this; }
  querySelector() { return new ElementMock(); }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 800 }; }
}

function studioContext(base, token) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'studio', 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const dynamicIds = [
    'apply-recipe',
    'apply-node',
    'delete-node',
    'duplicate-node',
    'node-id',
    'node-dependencies',
    'node-extra',
    'node-tokens',
    'select-adapter',
    'generate-adapter',
    'name-validation',
    'recipe-id',
    'recipe-version',
    'recipe-description',
    'recipe-modes'
  ];
  dynamicIds.forEach((id) => ids.add(id));
  const elements = new Map([...ids].map((id) => [id, new ElementMock(id)]));
  const listeners = {};
  const document = {
    activeElement: elements.get('canvas'),
    getElementById(id) { return elements.get(id) || null; },
    createElement() { return new ElementMock(); },
    createElementNS() { return new ElementMock(); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener(type, listener) { listeners[type] = listener; },
    elementFromPoint() { return null; }
  };
  const context = vm.createContext({
    console,
    document,
    Element: ElementMock,
    CSS: { escape: String },
    fetch: (url, options = {}) => fetch(new URL(url, base), {
      ...options,
      headers: { 'x-ael-studio-token': token, ...(options.headers || {}) }
    }),
    structuredClone,
    URL,
    URLSearchParams,
    Blob,
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout,
    clearTimeout,
    AbortController,
    TextDecoder,
    setInterval: () => 1,
    clearInterval() {},
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    window: {
      addEventListener() {},
      requestAnimationFrame: (callback) => setTimeout(callback, 0)
    }
  });
  return { context, elements, listeners };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for Studio state');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('Studio default route is the live run view and keeps about 40% of the previous element ids', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'studio', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.includes('live-view'));
  assert.ok(ids.includes('show-live'));
  assert.ok(ids.length <= 54, `default route has ${ids.length} ids; 40% of 135 is 54`);
  assert.equal(html.includes('id="library-panel"'), false);
  assert.equal(html.includes('id="custom-dialog"'), false);
  assert.equal(html.includes('id="import-dialog"'), false);
  assert.equal(html.includes('id="create-loop-group"'), false);
  assert.match(html, /id="show-live"[^>]*aria-current="page"/);
});

test('Studio canvas boots against its authenticated API and graph actions preserve Technical IDs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => elements.get('integrity').textContent.startsWith('VALID'));
    assert.equal(vm.runInContext('draft.loopGroups.length', context), 1);
    assert.equal(vm.runInContext('draft.loopGroups[0].decisionNodeId', context), 'judge');

    const initialEdges = vm.runInContext('draft.edges.length', context);
    vm.runInContext('deleteEdge(draft.edges[0].id)', context);
    assert.equal(vm.runInContext('draft.edges.length', context), initialEdges - 1);
    vm.runInContext('restoreHistory(historyIndex - 1)', context);
    assert.equal(vm.runInContext('draft.edges.length', context), initialEdges);

    const originalId = vm.runInContext('draft.nodes[0].id', context);
    const originalName = vm.runInContext('draft.nodes[0].displayName', context);
    assert.equal(vm.runInContext("applyDisplayName(draft.nodes[0], 'Readable Goal')", context), false);
    assert.equal(vm.runInContext('draft.nodes[0].id', context), originalId);
    assert.equal(vm.runInContext('draft.nodes[0].displayName', context), originalName);
    assert.equal(vm.runInContext(
      "authoringRecipe().nodes.every((node) => !Object.hasOwn(node, 'dependsOn'))",
      context
    ), true);
    assert.equal(vm.runInContext('typeof addNode', context), 'undefined');
    assert.equal(vm.runInContext('typeof duplicateSelectedNode', context), 'undefined');
    const nodeCount = vm.runInContext('draft.nodes.length', context);
    vm.runInContext("addEdge('goal', 'verification')", context);
    assert.equal(vm.runInContext('draft.nodes.length', context), nodeCount);
    assert.equal(vm.runInContext(
      "draft.edges.some((edge) => edge.from === 'goal' && edge.to === 'verification')",
      context
    ), true);
    await waitFor(() => elements.get('review').disabled === false);
    elements.get('review').onclick();
    assert.equal(elements.get('confirm').open, true);

    vm.runInContext('showWorkspace("runs")', context);
    await waitFor(() => Boolean(elements.get('run-list').innerHTML));
    assert.match(elements.get('run-list').innerHTML, /No runs found/);
    vm.runInContext('showWorkspace("workflows")', context);
    assert.equal(elements.get('canvas').hidden, false);

    const firstRun = await vm.runInContext(`api('/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        task: 'Keep this active Goal',
        recipeId: 'default',
        mode: 'ASSISTED'
      })
    })`, context);
    elements.get('goal-task').value = 'Create a replacement Goal';
    const continueChoice = vm.runInContext('activeRunId = null; catalog.live = null; ensureStudioRun()', context);
    await waitFor(() => elements.get('active-run-dialog').open === true);
    await elements.get('continue-active-run').onclick();
    assert.equal(await continueChoice, null);
    assert.equal(vm.runInContext('selectedCheckoutRun', context), firstRun.run.runId);
    await waitFor(() => elements.get('active-run-dialog').open === false);

    vm.runInContext('activeRunId = null; catalog.live = null; pinnedRunId = null', context);
    const replaceChoice = vm.runInContext('ensureStudioRun()', context);
    await waitFor(() => elements.get('active-run-dialog').open === true);
    elements.get('replace-active-run').onclick();
    const replacementRunId = await replaceChoice;
    assert.notEqual(replacementRunId, firstRun.run.runId);
    assert.match(elements.get('run-list').innerHTML, /Active now/);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

test('AC-1 empty Studio opens the simple task-first experience with advanced Goal fields optional', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => elements.get('integrity').textContent.startsWith('VALID'));
    await waitFor(() => elements.get('goal-dialog').open === true);
    assert.equal(elements.get('goal-dialog').open, true);
    assert.equal(elements.get('goal-task').disabled, false);
    assert.match(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'index.html'), 'utf8'),
      /id="start-agent"[^>]*>Start with AI Agent</
    );
    assert.equal(elements.get('goal-advanced').open, false);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

test('AC-4 successful clipboard handoff shows persistent paste and copy-again guidance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => elements.get('goal-dialog').open);
    elements.get('goal-task').value = 'Show persisted progress';
    await vm.runInContext('copyAgentHandoff()', context);
    assert.equal(elements.get('agent-handoff-state').hidden, false);
    assert.match(elements.get('agent-handoff-instructions').textContent, /Paste.*AI Agent terminal/i);
    assert.equal(elements.get('start-agent').textContent, 'Copy again');
    vm.runInContext("activeRunId = 'another-run'; renderHandoffState()", context);
    assert.equal(elements.get('agent-handoff-state').hidden, true);
    assert.equal(elements.get('start-agent').textContent, 'Start with AI Agent');
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

test('AC-6 Goal review shows the exact failure table and integrity metadata before explicit freeze', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => elements.get('goal-dialog').open);
    elements.get('goal-task').value = 'Review exact Goal content';
    elements.get('goal-text').value = 'Render the reviewed objective.';
    elements.get('goal-criteria').value =
      'Exact content remains visible | DOM assertion | Failure details disappear';
    await vm.runInContext('reviewGoal()', context);
    assert.match(elements.get('goal-review').innerHTML, /Exact content remains visible/);
    assert.match(elements.get('goal-review').innerHTML, /Failure details disappear/);
    assert.match(elements.get('goal-review').innerHTML, /Revision 1/);
    assert.match(elements.get('goal-review').innerHTML, /[a-f0-9]{64}/);
    assert.match(elements.get('goal-review').innerHTML, /<details/);
    assert.match(elements.get('goal-review').innerHTML, /Review all 1 criteria/);
    assert.equal(elements.get('confirm-freeze').hidden, false);
    assert.equal(vm.runInContext('goal.frozen', context), false);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

test('AC-9 cancelling an active-Run conflict resolves without replacing or mutating the Run', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => elements.get('goal-dialog').open);
    const choice = vm.runInContext(`resolveActiveRunConflict({
      runId: 'run-existing',
      displayName: 'Existing Run',
      state: 'STARTED'
    })`, context);
    elements.get('cancel-active-run-conflict').onclick();
    assert.equal(await choice, 'cancel');
    assert.equal(vm.runInContext('activeRunId', context), null);

    const dismissed = vm.runInContext(`resolveActiveRunConflict({
      runId: 'run-existing',
      displayName: 'Existing Run',
      state: 'STARTED'
    })`, context);
    elements.get('active-run-dialog').close();
    assert.equal(await dismissed, 'cancel');
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

test('AC-10 a reconnect failure keeps valid state and exposes a bounded manual retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => elements.get('integrity').textContent.startsWith('VALID'));
    const validDraftId = vm.runInContext('draft.id', context);
    context.fetch = async () => { throw new Error('offline'); };
    await vm.runInContext('resync()', context);
    assert.equal(elements.get('live-connection-state').hidden, false);
    assert.match(elements.get('live-connection-message').textContent, /connection lost/i);
    assert.equal(typeof elements.get('retry-live-connection').onclick, 'function');
    assert.equal(vm.runInContext('draft.id', context), validDraftId);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

test('DA-02 failed initial live loading does not masquerade as an empty first-run Studio', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    const authenticatedFetch = context.fetch;
    context.fetch = (url, options) => (
      String(url).includes('/api/events')
        ? Promise.reject(new Error('offline'))
        : authenticatedFetch(url, options)
    );
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => /connection lost/i.test(elements.get('live-connection-message').textContent));
    assert.equal(elements.get('goal-dialog').open, false);
    assert.match(elements.get('live-connection-message').textContent, /connection lost/i);
    context.fetch = authenticatedFetch;
    await elements.get('retry-live-connection').onclick();
    assert.equal(elements.get('goal-dialog').open, true);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

test('DA-06 malformed journey presentation degrades to a safe pending status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => elements.get('integrity').textContent.startsWith('VALID'));
    vm.runInContext(`catalog.live = {
      run: { state: 'STARTED' },
      plan: { nodes: [] },
      nodes: {},
      budget: { spentThisRun: 0, perRunTokenLimit: 1 },
      events: [],
      journey: { steps: [
        { id: '<unsafe>', status: '" onmouseover="alert(1)' },
        { id: null }
      ] }
    }; renderLive()`, context);
    assert.doesNotMatch(elements.get('run-journey').innerHTML, /onmouseover|<unsafe>/);
    assert.match(elements.get('run-journey').innerHTML, /class="unknown"/);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

test('Studio reconnects to /api/events with after=lastSeq when the stream ends', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    const realFetch = context.fetch;
    const realSetTimeout = context.setTimeout;
    const scheduled = [];
    const eventCalls = [];
    const lastSeq = 12;
    context.setTimeout = (fn, ms, ...rest) => {
      if (ms === 500 || ms === 1000 || ms === 2000 || ms === 5000) {
        scheduled.push({ fn, ms });
        return 0;
      }
      return realSetTimeout(fn, ms, ...rest);
    };
    context.fetch = async (url, options = {}) => {
      const href = String(url);
      if (href.includes('/api/events')) {
        eventCalls.push({ href, headers: options.headers || {} });
        const hello = `event: hello\ndata: ${JSON.stringify({
          type: 'hello',
          seq: lastSeq,
          mode: 'poll',
          root: '/tmp/studio',
          currentRunId: null
        })}\n\n`;
        const encoded = Buffer.from(hello, 'utf8');
        const hang = eventCalls.length > 1;
        let sent = false;
        return {
          ok: true,
          body: {
            getReader() {
              return {
                async read() {
                  if (!sent) {
                    sent = true;
                    return { done: false, value: encoded };
                  }
                  if (hang) {
                    await new Promise((_, reject) => {
                      const abort = options.signal;
                      const fail = () => {
                        const error = new Error('aborted');
                        error.name = 'AbortError';
                        reject(error);
                      };
                      if (!abort) return;
                      if (abort.aborted) fail();
                      else abort.addEventListener('abort', fail);
                    });
                  }
                  return { done: true, value: undefined };
                }
              };
            }
          }
        };
      }
      return realFetch(url, options);
    };
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => elements.get('integrity').textContent.startsWith('VALID'));
    await waitFor(() => scheduled.some((item) => item.ms === 500));
    assert.equal(eventCalls.length, 1);
    scheduled[0].fn();
    await waitFor(() => eventCalls.length >= 2);
    assert.match(eventCalls[1].href, /after=12/);
    const resumeHeaders = eventCalls[1].headers;
    assert.equal(String(resumeHeaders['Last-Event-ID'] || resumeHeaders['last-event-id']), '12');
    assert.equal(typeof elements.get('retry-live-connection').onclick, 'function');
    vm.runInContext('eventAbort && eventAbort.abort(); clearReconnectTimer()', context);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});
