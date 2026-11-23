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
  const defined = new Set([...tokens.matchAll(/--([a-z0-9-]+):/g), ...css.matchAll(/--([a-z0-9-]+):/g)].map((match) => match[1]));
  assert.deepStrictEqual([...used].filter((name) => !defined.has(name)), []);
  assert.match(read('index.html'), /href="\/tokens\.css"[\s\S]*href="\/styles\.css"/);
});

test('option C colours: done green, now orange with a halo, pending paper, bots from tokens in both themes', () => {
  const css = read('styles.css');
  assert.match(css, /\.stage\.done i\{border-color:var\(--ok-fill\);background:var\(--ok-fill\)\}/);
  assert.match(css, /\.stage\.now\{color:var\(--text\)\}/);
  assert.match(css, /\.stage\.now i\{border-color:var\(--brand\);box-shadow:var\(--halo-now\)\}/);
  assert.match(css, /\.stage i\{[^}]*border:2px solid var\(--line-strong\)[^}]*background:var\(--surface-2\)/);
  assert.match(css, /\.primary\{[^}]*background:var\(--brand\)/);
  assert.match(css, /\.bot\{[^}]*radial-gradient\(circle at 32% 28%,var\(--brand-highlight\) 0%,var\(--brand\) 38%,var\(--brand-hover\) 72%,var\(--brand-deep\) 100%\)/);
  assert.match(css, /\.bot::before,\.bot::after\{[^}]*background:var\(--on-brand\)/);
  assert.match(css, /\.bot-waiting\{outline:2px solid var\(--brand\)/);
  assert.match(css, /\.bot-idle,\.bot-missing\{background:radial-gradient\([^)]*var\(--idle-highlight\)/);
  assert.match(css, /\.project-row\[aria-current="true"\]\{background:var\(--surface-2\);border-color:var\(--line\);box-shadow:var\(--shadow-raised\)\}/);
  const tokens = read('tokens.css');
  const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
  const media = tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)'));
  for (const name of ['ok-fill', 'idle-highlight', 'idle', 'idle-deep']) {
    assert.match(tokens, new RegExp(`--${name}: #`), `${name} light`);
    assert.match(dark, new RegExp(`--${name}: #`), `${name} dark`);
    assert.match(media, new RegExp(`--${name}: #`), `${name} dark media`);
  }
});

test('motion: named properties, no ease-in, a short keyframe list, press feedback, gated hover', () => {
  const css = read('styles.css');
  assert.doesNotMatch(css, /transition:\s*(all\b|\.\d|\d+m?s\b)/);
  assert.doesNotMatch(css, /transition-property:\s*all\b/);
  assert.doesNotMatch(css, /\bease-in\b(?!-out)/);
  const keyframes = [...css.matchAll(/@keyframes ([a-z-]+)/g)].map((match) => match[1]).sort();
  assert.deepStrictEqual(keyframes, ['bubble-pop', 'detail-fade', 'detail-in'], 'no looping animation in CSS');
  assert.match(css, /:active:not\(:disabled\)[^{]*\{transform:scale\(\.97\)\}/);
  assert.match(css, /:focus-visible\{outline:2px solid var\(--focus\)/);
  const gate = css.indexOf('@media (hover:hover) and (pointer:fine){');
  assert.ok(gate > 0, 'hover media block exists');
  const before = css.slice(0, gate);
  assert.doesNotMatch(before, /:hover/, 'every :hover rule sits inside the hover media block');
  const reduced = css.match(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*)$/);
  assert.ok(reduced, 'reduced motion block exists');
  assert.match(reduced[1], /\.ring-orbit,\.ring-bot\{transition-property:opacity\}/, 'reduced motion: the bot jumps, fades stay');
  assert.match(css, /\.ring-orbit\{[^}]*transition:transform 520ms var\(--ease-out\)/);
  assert.match(reduced[1], /animation-name:detail-fade/, 'reduced motion keeps the fade');
  assert.doesNotMatch(css.match(/@keyframes detail-fade\{[^}]*\}[^}]*\}/)[0], /transform/);
});
