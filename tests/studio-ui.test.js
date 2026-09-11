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
  }

  addEventListener() {}
  setAttribute() {}
  append() {}
  insertAdjacentHTML(_position, value) { this.innerHTML += value; }
  remove() {}
  setPointerCapture() {}
  focus() {}
  select() {}
  blur() { this.onblur?.({ currentTarget: this }); }
  showModal() { this.open = true; }
  close() { this.open = false; }
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
    setInterval: () => 1,
    clearInterval() {},
    window: { addEventListener() {} }
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

test('Studio canvas boots against its authenticated API and graph actions preserve Technical IDs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-ui-'));
  const instance = createStudioServer(root, { token: 'ui-test-token' });
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
    vm.runInContext("applyDisplayName(draft.nodes[0], 'Readable Goal')", context);
    assert.equal(vm.runInContext('draft.nodes[0].id', context), originalId);
    assert.equal(vm.runInContext('draft.nodes[0].displayName', context), 'Readable Goal');
    assert.equal(vm.runInContext("applyDisplayName(draft.nodes[0], '   ')", context), false);
    assert.equal(vm.runInContext('draft.nodes[0].displayName', context), 'Readable Goal');
    assert.equal(vm.runInContext(
      "authoringRecipe().nodes.every((node) => !Object.hasOwn(node, 'dependsOn'))",
      context
    ), true);

    const initialNodes = vm.runInContext('draft.nodes.length', context);
    vm.runInContext(
      "pendingConnectionSource = draft.nodes[0].id; addNode('condition', { x: 500, y: 300 })",
      context
    );
    assert.equal(vm.runInContext('draft.nodes.length', context), initialNodes + 1);
    assert.equal(vm.runInContext(
      'draft.edges.some((edge) => edge.from === draft.nodes[0].id && edge.to === draft.nodes.at(-1).id)',
      context
    ), true);

    const connectedPair = vm.runInContext('[draft.nodes[0].id, draft.nodes.at(-1).id]', context);
    vm.runInContext(
      'selectedIds = new Set([draft.nodes[0].id, draft.nodes.at(-1).id]); duplicateSelectedNode()',
      context
    );
    assert.equal(vm.runInContext('selectedIds.size', context), 2);
    assert.equal(vm.runInContext('draft.nodes.length', context), initialNodes + 3);
    assert.equal(vm.runInContext(
      'draft.edges.some((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))',
      context
    ), true);
    assert.equal(connectedPair.length, 2);

    vm.runInContext('showWorkspace("runs")', context);
    await waitFor(() => Boolean(elements.get('run-list').innerHTML));
    assert.match(elements.get('run-list').innerHTML, /No runs found/);
    vm.runInContext('showWorkspace("workflows")', context);
    assert.equal(elements.get('canvas').hidden, false);
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
});
