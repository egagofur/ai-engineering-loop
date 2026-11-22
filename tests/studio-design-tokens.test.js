'use strict';

// Studio redesign guard: colours live only in tokens.css, motion follows the
// Emil rules (named properties, ease-out, short loops list), hover is gated.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'studio', file), 'utf8');

test('styles.css has no raw colours; tokens.css defines the brand, light and dark themes', () => {
  const css = read('styles.css');
  assert.deepStrictEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g), null);
  assert.doesNotMatch(css, /\brgba?\(/);
  const tokens = read('tokens.css');
  assert.match(tokens, /--brand: #fc6404;/);
  assert.match(tokens, /:root\[data-theme="dark"\]/);
  assert.match(tokens, /@media \(prefers-color-scheme: dark\)/);
  for (const name of ['surface-1', 'surface-2', 'text', 'muted', 'line', 'brand', 'ok', 'warn', 'danger', 'focus']) {
    assert.match(tokens, new RegExp(`--${name}:`), name);
  }
  const used = new Set([...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((match) => match[1]));
  const defined = new Set([...tokens.matchAll(/--([a-z0-9-]+):/g)].map((match) => match[1]));
  const local = new Set(['checkout-width', 'checkout-height', 'transform-origin']);
  assert.deepStrictEqual([...used].filter((name) => !defined.has(name) && !local.has(name)), []);
  assert.match(read('index.html'), /href="\/tokens\.css"[\s\S]*href="\/styles\.css"/);
});

test('passed is green (ok), brand orange is for action and live state', () => {
  const css = read('styles.css');
  assert.match(css, /\.stage-rail li\.passed::before\{border-color:var\(--ok\)/);
  assert.match(css, /\.status-pill\.status-passed\{background:var\(--ok-soft\);color:var\(--ok\)\}/);
  assert.match(css, /\.primary\{background:var\(--brand\)/);
});

test('motion: named properties, no ease-in, a short keyframe list, press feedback, gated hover', () => {
  const css = read('styles.css');
  assert.doesNotMatch(css, /transition:\s*(all\b|\.\d|\d+m?s\b)/);
  assert.doesNotMatch(css, /\bease-in\b(?!-out)/);
  const keyframes = [...css.matchAll(/@keyframes ([a-z-]+)/g)].map((match) => match[1]).sort();
  assert.deepStrictEqual(keyframes, ['flow', 'freeze-pop', 'node-mark-spin', 'presence-pulse']);
  assert.match(css, /:active:not\(:disabled\)[^{]*\{transform:scale\(\.97\)\}/);
  assert.match(css, /:focus-visible\{outline:2px solid var\(--focus\)/);
  const gate = css.indexOf('@media (hover:hover) and (pointer:fine){');
  assert.ok(gate > 0, 'hover media block exists');
  const before = css.slice(0, gate);
  assert.doesNotMatch(before, /:hover/, 'every :hover rule sits inside the hover media block');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]*animation:none/);
});

test('the server serves tokens.css and nothing outside the asset allowlist', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'lib', 'studio-server.js'), 'utf8');
  assert.match(server, /\['index\.html', 'app\.js', 'styles\.css', 'tokens\.css'\]/);
});
