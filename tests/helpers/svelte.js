'use strict';

// Server-renders Studio components in Node so tests can read their markup.
// Svelte's hydration comments are stripped; everything else is the real output.
const { register } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const STUDIO = path.join(__dirname, '..', '..', 'studio');
let registered = false;

function ensureHooks() {
  if (registered) return;
  register('./svelte-hooks.mjs', pathToFileURL(__filename));
  registered = true;
}

function clean(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

async function renderComponent(file, props = {}) {
  ensureHooks();
  const { render } = await import('svelte/server');
  const component = await import(pathToFileURL(path.join(STUDIO, 'src', file)).href);
  return clean(render(component.default, { props }).body);
}

const noop = () => {};

module.exports = { STUDIO, clean, noop, renderComponent };
