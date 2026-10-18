'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'studio', 'index.html'), 'utf8');
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

function keyEvent(key, target, extras = {}) {
  return {
    key,
    code: '',
    target,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: key === '?',
    preventDefault() {},
    stopPropagation() {},
    ...extras
  };
}

module.exports = {
  ClassList,
  ElementMock,
  studioContext,
  waitFor,
  walkElements,
  findBy,
  keyEvent
};
