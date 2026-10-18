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
    this.children = [];
    this.attributes = {};
  }

  get innerHTML() { return this._innerHTML; }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    if (!this._innerHTML) this.children = [];
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...nodes) { this.children.push(...nodes); }
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
  assert.ok(ids.includes('wiring-bar'));
  assert.ok(ids.includes('run-summary-card'));
  assert.equal(ids.includes('integrity'), false);
  assert.equal(ids.includes('review'), false);
  assert.ok(ids.length <= 62, `default route has ${ids.length} ids`);
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
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
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
    vm.runInContext("addEdge('verification', 'judge')", context);
    assert.equal(vm.runInContext('draft.nodes.length', context), nodeCount);
    assert.equal(vm.runInContext(
      "draft.edges.some((edge) => edge.from === 'verification' && edge.to === 'judge')",
      context
    ), true);
    await waitFor(() => elements.get('save-wiring').disabled === false);
    elements.get('save-wiring').onclick();
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
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
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
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
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
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
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
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
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

test('Wiring canvas uses one n8n tile per node and fits the default recipe', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements } = studioContext(base, instance.token);
    const paths = [];
    context.document.createElementNS = () => {
      const element = new ElementMock();
      paths.push(element);
      return element;
    };
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
    vm.runInContext('renderGraph()', context);
    const rendered = elements.get('nodes').children;
    const nodeCount = vm.runInContext('draft.nodes.length', context);
    assert.equal(rendered.length, nodeCount);
    assert.ok(nodeCount > 1);
    const types = [
      'goal-contract', 'maker', 'verification', 'devil-advocate', 'judge',
      'approval', 'delivery', 'report', 'agent', 'command'
    ];
    const generic = vm.runInContext('nodeIcon("unlisted")', context);
    const seen = new Set();
    for (const type of types) {
      const icon = vm.runInContext(`nodeIcon(${JSON.stringify(type)})`, context);
      assert.match(icon, /<svg/);
      assert.notEqual(icon, generic);
      seen.add(icon);
    }
    assert.equal(seen.size, types.length);
    assert.equal(vm.runInContext('nodeIcon("command-runner")', context), generic);

    for (const node of rendered) {
      const visible = node.innerHTML
        .replace(/\s(?:title|aria-label)="[^"]*"/g, '')
        .replace(/<[^>]+>/g, ' ');
      assert.match(node.innerHTML, /class="node-icon"[\s\S]*<svg/);
      assert.match(node.innerHTML, /class="node-name"/);
      assert.equal((node.innerHTML.match(/class="node-status"/g) || []).length, 1);
      assert.doesNotMatch(node.innerHTML, /class="status"|class="node-title"|class="technical-id"|✓ PASSED/);
      assert.doesNotMatch(visible, /STAGE|STEP \d/);
      assert.match(node.title, /·/);
      assert.ok(node.dataset.status);
      assert.ok(node.dataset.nodeType);
      assert.match(node.innerHTML, new RegExp(`title="[^"]*${node.dataset.nodeType}`));
    }

    const statusLines = vm.runInContext(`(() => {
      const node = draft.nodes[0];
      return {
        duration: nodeStatusLine({ status: 'passed', durationMs: 370000 }),
        range: nodeStatusLine({
          status: 'PASSED',
          startedAt: '2026-10-18T00:00:00.000Z',
          completedAt: '2026-10-18T00:01:52.000Z'
        }),
        unknown: nodeStatusLine({ status: 'passed' }),
        pending: nodeStatusLine(null)
      };
    })()`, context);
    assert.equal(statusLines.duration, 'Passed · 6m 10s');
    assert.equal(statusLines.range, 'Passed · 1m 52s');
    assert.equal(statusLines.unknown, 'Passed');
    assert.equal(statusLines.pending, 'Pending');

    paths.length = 0;
    const activeTarget = vm.runInContext(`(() => {
      const edge = draft.edges[0];
      catalog.live = { nodes: { [edge.to]: { status: 'RUNNING', durationMs: 124000 } }, edges: [] };
      renderGraph();
      return edge.to;
    })()`, context);
    const activePaths = paths.filter((path) => /\bedge-active\b/.test(path.attributes.class || ''));
    const expectedActive = vm.runInContext(
      `draft.edges.filter((edge) => edge.to === ${JSON.stringify(activeTarget)}).length`,
      context
    );
    assert.equal(activePaths.length, expectedActive);
    assert.match(activePaths[0].attributes.class, /\bedge-active\b/);
    const quiet = vm.runInContext(`(() => {
      const edge = draft.edges[0];
      catalog.live = { nodes: {}, edges: [{ id: edge.id, state: 'passed' }] };
      return edgeClassName(edge);
    })()`, context);
    assert.doesNotMatch(quiet, /edge-active/);
    const byState = vm.runInContext(`(() => {
      const edge = draft.edges[0];
      catalog.live = { nodes: {}, edges: [{ id: edge.id, state: 'active' }] };
      return edgeClassName(edge);
    })()`, context);
    assert.match(byState, /\bedge-active\b/);
    assert.equal(vm.runInContext('edgeDeleteClass(draft.edges[0])', context), 'edge-delete');

    const loop = vm.runInContext(`(() => {
      positions = defaultGraphPositions();
      const group = draft.loopGroups[0];
      const bounds = loopBounds(group);
      const label = loopLabelText(group, { iteration: 2 });
      const rect = placeLoopLabel(bounds, label);
      return { label, overlaps: loopLabelOverlapsEdge(rect) };
    })()`, context);
    assert.match(loop.label, / · iteration 2 \/ /);
    assert.equal(loop.overlaps, false);

    const fit = vm.runInContext(`(() => {
      positions = defaultGraphPositions();
      const bounds = graphBounds();
      const next = computeFit(bounds, 1280, 800);
      const boxes = draft.nodes.map((node) => {
        const pos = positions.get(node.id);
        return {
          id: node.id,
          left: next.x + pos.x * next.scale,
          right: next.x + (pos.x + NODE_WIDTH) * next.scale,
          top: next.y + pos.y * next.scale,
          bottom: next.y + (pos.y + NODE_BLOCK_HEIGHT) * next.scale
        };
      });
      return { scale: next.scale, boxes };
    })()`, context);
    assert.ok(fit.scale >= 0.2 && fit.scale <= 2.5);
    for (const box of fit.boxes) {
      assert.ok(box.left >= -0.01 && box.right <= 1280.01, `${box.id} overflows horizontally`);
      assert.ok(box.top >= -0.01 && box.bottom <= 800.01, `${box.id} overflows vertically`);
    }

    const css = fs.readFileSync(path.join(__dirname, '..', 'studio', 'styles.css'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
    assert.match(css, /\.edge-delete\{[^}]*visibility:\s*hidden/);
    assert.match(css, /\.edge-delete\.visible,\.edge-delete\.selected/);
    assert.match(css, /prefers-reduced-motion:reduce\)[\s\S]*?animation:\s*none/);
    assert.match(css, /\.edge\.edge-active\{[^}]*animation:\s*flow/);
    assert.match(app, /addEventListener\('resize', scheduleFitView\)/);
    assert.equal(app.includes('edge-label'), false);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

function walkElements(root, visit, seen = new Set()) {
  if (!root || seen.has(root)) return;
  seen.add(root);
  visit(root);
  for (const child of root.children || []) walkElements(child, visit, seen);
}

function findBy(root, predicate) {
  let found = null;
  walkElements(root, (element) => {
    if (!found && predicate(element)) found = element;
  });
  return found;
}

function keyEvent(key, target) {
  return {
    key,
    code: '',
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: key === '?',
    preventDefault() {},
    stopPropagation() {}
  };
}

test('Wiring inspection opens a node panel, tooltip, zoom, minimap, and shortcuts', async () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
  assert.equal(appSource.includes('style="'), false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements, listeners } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
    vm.runInContext("showWorkspace('wiring')", context);
    const canvas = elements.get('canvas');
    const panel = elements.get('node-panel');
    const nodes = elements.get('nodes').children;
    assert.ok(nodes.length > 1);
    const node = nodes[0];
    assert.equal(node.tabIndex, 0);
    assert.equal(node.attributes.role, 'button');
    assert.match(node.attributes['aria-label'], /, /);
    node.listeners.click[0]({
      target: node,
      currentTarget: node,
      shiftKey: false,
      button: 0
    });
    assert.equal(panel.hidden, false);
    assert.match(panel.innerHTML, /role="tablist"/);
    assert.equal((panel.innerHTML.match(/role="tab"/g) || []).length, 4);
    assert.match(panel.innerHTML, /Input/);
    assert.match(panel.innerHTML, /Output/);
    assert.match(panel.innerHTML, /Evidence/);
    assert.match(panel.innerHTML, /Timeline/);
    assert.match(panel.innerHTML, /No run to inspect/);
    listeners.keydown(keyEvent('Escape', canvas));
    assert.equal(panel.hidden, true);

    const tooltip = findBy(canvas, (element) => element.attributes.role === 'tooltip');
    assert.equal(tooltip.hidden, true);
    node.listeners.focus[0]({ currentTarget: node, target: node });
    assert.equal(tooltip.hidden, true);
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(tooltip.hidden, false);
    assert.match(tooltip.innerHTML, /·/);
    assert.match(tooltip.innerHTML, new RegExp(node.dataset.nodeType));
    node.listeners.blur[0]({ currentTarget: node, target: node });
    assert.equal(tooltip.hidden, true);

    vm.runInContext('zoomAt(1)', context);
    const zoomIn = findBy(canvas, (element) => element.attributes['aria-label'] === 'Zoom in');
    const zoomOut = findBy(canvas, (element) => element.attributes['aria-label'] === 'Zoom out');
    const level = findBy(canvas, (element) => element.attributes['aria-label'] === 'Zoom level');
    assert.equal(level.textContent, '100%');
    zoomIn.onclick({});
    const zoomed = vm.runInContext('viewport.scale', context);
    assert.ok(zoomed > 1);
    assert.match(level.textContent, /%/);
    zoomOut.onclick({});
    assert.ok(vm.runInContext('viewport.scale', context) < zoomed);

    vm.runInContext('viewport = { x: 20, y: 30, scale: 1 }', context);
    const expected = vm.runInContext(`(() => {
      const bounds = graphBounds();
      return computeFit(bounds, 1200, 800);
    })()`, context);
    listeners.keydown(keyEvent('f', canvas));
    const fitted = vm.runInContext('({ x: viewport.x, y: viewport.y, scale: viewport.scale })', context);
    assert.equal(fitted.scale, expected.scale);
    assert.ok(Math.abs(fitted.x - expected.x) < 0.001);
    assert.ok(Math.abs(fitted.y - expected.y) < 0.001);

    vm.runInContext('selectedId = null; selectedIds = new Set();', context);
    listeners.keydown(keyEvent('ArrowRight', canvas));
    const first = vm.runInContext('selectedId', context);
    listeners.keydown(keyEvent('ArrowRight', canvas));
    const second = vm.runInContext('selectedId', context);
    assert.ok(first);
    assert.notEqual(first, second);
    listeners.keydown(keyEvent('ArrowLeft', canvas));
    assert.equal(vm.runInContext('selectedId', context), first);

    const sheet = elements.get('shortcut-sheet');
    assert.equal(sheet.open, false);
    listeners.keydown(keyEvent('?', canvas));
    assert.equal(sheet.open, true);
    listeners.keydown(keyEvent('?', canvas));
    assert.equal(sheet.open, false);

    vm.runInContext('renderMinimap()', context);
    const minimap = findBy(canvas, (element) => element.attributes['aria-label'] === 'Workflow minimap');
    const rects = (minimap.children || []).filter((element) =>
      String(element.attributes.class || '').split(/\s+/).includes('minimap-node')
    );
    assert.equal(rects.length, nodes.length);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});

test('studio wiring client does not add a setInterval', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
  assert.equal((app.match(/setInterval/g) || []).length, 0);
  assert.equal(app.includes('style="'), false);
});

test('Wiring save bar, rewiring validation, durations, and completed-run summary', async () => {
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
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
    const bar = elements.get('wiring-bar');
    const savedEdges = vm.runInContext('draft.edges.length', context);
    assert.equal(bar.hidden, true);

    vm.runInContext(`positions.set(draft.nodes[0].id, { x: 12, y: 24 }); renderWiringBar()`, context);
    assert.equal(bar.hidden, true);
    assert.equal(vm.runInContext('draft.edges.length', context), savedEdges);

    const first = vm.runInContext('draft.edges[0]', context);
    assert.equal(vm.runInContext("addEdge('maker', 'maker')", context), false);
    assert.equal(vm.runInContext(
      `addEdge(${JSON.stringify(first.from)}, ${JSON.stringify(first.to)})`,
      context
    ), false);
    assert.equal(vm.runInContext('draft.edges.length', context), savedEdges);
    assert.equal(bar.hidden, true);

    assert.equal(vm.runInContext("addEdge('verification', 'judge')", context), true);
    assert.equal(bar.hidden, false);
    assert.equal(elements.get('wiring-count').textContent, '1 wiring change');
    await waitFor(() => elements.get('save-wiring').disabled === false);
    assert.match(elements.get('wiring-pill').textContent, /^Valid [a-f0-9]{8}$/);
    elements.get('discard-wiring').onclick();
    assert.equal(bar.hidden, true);
    assert.equal(vm.runInContext('draft.edges.length', context), savedEdges);
    assert.equal(vm.runInContext(
      "draft.edges.some((edge) => edge.from === 'verification' && edge.to === 'judge')",
      context
    ), false);

    vm.runInContext(`(() => {
      const edge = draft.edges.find((item) => item.to === 'delivery');
      deleteEdge(edge.id);
    })()`, context);
    assert.equal(elements.get('save-wiring').disabled, true);
    await waitFor(() => elements.get('wiring-error').textContent.includes('BACKBONE_'));
    const invalidText = elements.get('wiring-error').textContent;
    assert.match(invalidText, /BACKBONE_[A-Z0-9_]+/);
    assert.match(invalidText, /delivery must depend on|ASSISTED/);
    assert.equal(elements.get('save-wiring').disabled, true);
    assert.match(elements.get('wiring-pill').textContent, /^Invalid/);
    elements.get('discard-wiring').onclick();
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
    assert.equal(bar.hidden, true);

    const repointed = vm.runInContext(`(() => {
      const edge = draft.edges.find((item) => item.from === 'maker' && item.to === 'verification');
      return { ok: repointEdge(edge.id, 'goal', 'verification'), id: edge.id };
    })()`, context);
    assert.equal(repointed.ok, true);
    await waitFor(() => elements.get('wiring-error').textContent.includes('verification must depend on maker'));
    assert.equal(elements.get('save-wiring').disabled, true);
    assert.equal(vm.runInContext(`invalidEdgeIds.has(${JSON.stringify(repointed.id)})`, context), true);
    assert.match(vm.runInContext(
      `edgeClassName(draft.edges.find((edge) => edge.id === ${JSON.stringify(repointed.id)}))`,
      context
    ), /\bedge-invalid\b/);
    assert.match(vm.runInContext(`edgeIssueText(${JSON.stringify(repointed.id)})`, context), /verification must depend on maker/);

    const durations = vm.runInContext(`(() => {
      const recipe = {
        nodes: [
          { id: 'root' },
          { id: 'left' },
          { id: 'right' },
          { id: 'join' },
          { id: 'running' },
          { id: 'idle' }
        ],
        edges: [
          { from: 'root', to: 'left' },
          { from: 'left', to: 'join' },
          { from: 'right', to: 'join' },
          { from: 'join', to: 'running' }
        ]
      };
      const live = {
        run: { createdAt: '2026-10-18T00:00:00.000Z' },
        nodes: {
          root: { status: 'PASSED', updatedAt: '2026-10-18T00:01:00.000Z' },
          left: { status: 'PASSED', updatedAt: '2026-10-18T00:02:00.000Z' },
          right: { status: 'PASSED', updatedAt: '2026-10-18T00:04:00.000Z' },
          join: { status: 'FAILED', updatedAt: '2026-10-18T00:04:30.000Z' },
          running: { status: 'RUNNING', updatedAt: '2026-10-18T00:04:30.000Z' },
          idle: { status: 'SKIPPED', updatedAt: '2026-10-18T00:09:00.000Z' }
        }
      };
      return {
        root: nodeDurationMs('root', live, recipe),
        join: nodeDurationMs('join', live, recipe),
        running: nodeDurationMs('running', live, recipe),
        idle: nodeDurationMs('idle', live, recipe),
        missing: nodeDurationMs('missing', live, recipe),
        expectedRunning: Date.now() - Date.parse('2026-10-18T00:04:30.000Z')
      };
    })()`, context);
    assert.equal(durations.root, 60_000);
    assert.equal(durations.join, 30_000);
    assert.equal(durations.idle, null);
    assert.equal(durations.missing, null);
    assert.ok(Math.abs(durations.running - durations.expectedRunning) < 1000);

    vm.runInContext(`catalog.live = {
      run: {
        runId: 'run-delivered',
        state: 'DELIVERED',
        createdAt: '2026-10-18T00:00:00.000Z',
        updatedAt: '2026-10-18T00:12:00.000Z',
        destination: 'origin/main'
      },
      plan: { nodes: [
        { id: 'approval', type: 'approval' },
        { id: 'delivery', type: 'delivery' },
        { id: 'maker', type: 'maker' }
      ] },
      nodes: {
        approval: { status: 'PASSED', approvedBy: 'ada', updatedAt: '2026-10-18T00:10:00.000Z' },
        delivery: { status: 'PASSED', updatedAt: '2026-10-18T00:12:00.000Z' },
        maker: { status: 'PASSED', updatedAt: '2026-10-18T00:04:00.000Z' }
      },
      artifacts: {
        'artifact.verdict': { verdict: 'PASS', action: 'deliver' },
        'artifact.verification': { passed: true, failed: 0, commandCount: 4 },
        'artifact.findings': { count: 3, blocking: 1 },
        'artifact.drift': { outOfMapCount: 2 },
        'artifact.receipt': { present: true, verified: true, problems: [] }
      },
      budget: { spentThisRun: 0, perRunTokenLimit: 1000 }
    }; renderRunSummary()`, context);
    const card = elements.get('run-summary-card');
    assert.equal(card.hidden, false);
    assert.match(card.innerHTML, /State<\/span><strong>DELIVERED<\/strong>/);
    assert.match(card.innerHTML, /Destination<\/span><strong>origin\/main<\/strong>/);
    assert.match(card.innerHTML, /Verdict<\/span><strong>PASS<\/strong>/);
    assert.match(card.innerHTML, /Approver<\/span><strong>ada<\/strong>/);
    assert.match(card.innerHTML, /Duration<\/span><strong>12m 00s<\/strong>/);
    assert.match(card.innerHTML, /Tests<\/span><strong>4 passed \/ 0 failed<\/strong>/);
    assert.match(card.innerHTML, /Findings<\/span><strong>3 \/ 1<\/strong>/);
    assert.match(card.innerHTML, /Drift<\/span><strong>2<\/strong>/);
    assert.match(card.innerHTML, /Receipt<\/span><strong>verified<\/strong>/);
    assert.match(card.innerHTML, /Tokens<\/span><strong>unknown<\/strong>/);
    vm.runInContext(`delete catalog.live.artifacts['artifact.verdict']; catalog.live.run.verdict = ''; renderRunSummary()`, context);
    assert.match(card.innerHTML, /Verdict<\/span><strong>—<\/strong>/);
    vm.runInContext(`catalog.live.artifacts['artifact.verdict'] = { verdict: 'PASS' }; renderRunSummary()`, context);

    const liveCalls = [];
    const previousFetch = context.fetch;
    context.fetch = (url, options) => {
      liveCalls.push(String(url));
      return previousFetch(url, options);
    };
    vm.runInContext(`applyEvent({
      type: 'artifact.verification',
      runId: 'run-delivered',
      payload: { passed: false, failed: 2, commandCount: 4 }
    })`, context);
    await waitFor(() => card.innerHTML.includes('2 passed / 2 failed'));
    assert.equal(liveCalls.some((url) => url.includes('/api/live')), false);
    assert.match(card.innerHTML, /State<\/span><strong>DELIVERED<\/strong>/);
    assert.match(card.innerHTML, /Tokens<\/span><strong>unknown<\/strong>/);

    vm.runInContext(`showWorkspace('wiring'); applyEvent({
      type: 'lifecycle',
      runId: 'run-delivered',
      payload: { events: [{ nodeId: 'maker', status: 'RUNNING', at: '2026-10-18T00:11:00.000Z' }] }
    })`, context);
    await waitFor(() => {
      const maker = elements.get('nodes').children.find((node) => node.dataset.nodeId === 'maker');
      return maker && maker.dataset.status === 'active' && maker.innerHTML.includes('Running');
    });
    vm.runInContext('renderMinimap()', context);
    const minimap = [...elements.get('canvas').children].find((element) =>
      String(element.attributes['aria-label'] || '') === 'Workflow minimap'
    );
    assert.ok((minimap?.children || []).some((node) =>
      String(node.attributes.class || '').includes('minimap-active')
    ));
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});
