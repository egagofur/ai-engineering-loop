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
  assert.doesNotMatch(css, /\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/);
  const tokens = read('tokens.css');
  assert.match(tokens, /--brand: #fc6404;/);
  assert.match(tokens, /:root\[data-theme="dark"\]/);
  assert.match(tokens, /@media \(prefers-color-scheme: dark\)/);
  for (const name of ['surface-1', 'surface-2', 'text', 'muted', 'line', 'brand', 'ok', 'warn', 'danger', 'focus']) {
    assert.match(tokens, new RegExp(`--${name}:`), name);
  }
  const used = new Set([...css.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((match) => match[1]));
  const defined = new Set([...tokens.matchAll(/--([a-z0-9-]+):/g)].map((match) => match[1]));
  assert.deepStrictEqual([...used].filter((name) => !defined.has(name)), []);
  assert.match(read('index.html'), /href="\/tokens\.css"[\s\S]*href="\/styles\.css"/);
});

test('done is green (ok), brand orange is for the Freeze action and live state', () => {
  const css = read('styles.css');
  assert.match(css, /\.stage-rail li\[data-status="done"\]::before\{[^}]*background:var\(--ok\)/);
  assert.match(css, /\.stage-rail li\[data-status="now"\]::before\{[^}]*background:var\(--brand\)/);
  assert.match(css, /\.primary\{[^}]*background:var\(--brand\)/);
  assert.match(css, /\.bot-working\{[^}]*background:var\(--brand\)/);
});

test('motion: named properties, no ease-in, a short keyframe list, press feedback, gated hover', () => {
  const css = read('styles.css');
  assert.doesNotMatch(css, /transition:\s*(all\b|\.\d|\d+m?s\b)/);
  assert.doesNotMatch(css, /transition-property:\s*all\b/);
  assert.doesNotMatch(css, /\bease-in\b(?!-out)/);
  const keyframes = [...css.matchAll(/@keyframes ([a-z-]+)/g)].map((match) => match[1]).sort();
  assert.deepStrictEqual(keyframes, ['bot-pulse', 'detail-fade', 'detail-in']);
  assert.match(css, /:active:not\(:disabled\)[^{]*\{transform:scale\(\.97\)\}/);
  assert.match(css, /:focus-visible\{outline:2px solid var\(--focus\)/);
  const gate = css.indexOf('@media (hover:hover) and (pointer:fine){');
  assert.ok(gate > 0, 'hover media block exists');
  const before = css.slice(0, gate);
  assert.doesNotMatch(before, /:hover/, 'every :hover rule sits inside the hover media block');
  const reduced = css.match(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*)$/);
  assert.ok(reduced, 'reduced motion block exists');
  assert.match(reduced[1], /\.bot-working::after\{animation:none/);
  assert.match(reduced[1], /animation-name:detail-fade/, 'reduced motion keeps the fade');
  assert.doesNotMatch(css.match(/@keyframes detail-fade\{[^}]*\}[^}]*\}/)[0], /transform/);
});
