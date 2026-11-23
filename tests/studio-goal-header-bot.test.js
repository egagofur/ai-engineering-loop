'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const studio = path.join(__dirname, '..', 'studio');
const load = (file) => import(pathToFileURL(path.join(studio, 'js', file)).href);
const read = (file) => fs.readFileSync(path.join(studio, file), 'utf8');
const STAGES = ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'];

test('markdown renders headings, paragraphs, nested lists, emphasis, code and http links', async () => {
  const { renderMarkdown } = await load('markdown.js');
  const html = renderMarkdown([
    '# Goal for Run r1',
    '',
    '## Done when',
    '',
    'AC-1. It shows **bold** and *soft* and `x < y`',
    '   - Proof: test.',
    '   - Fail if: hidden',
    '',
    '1. first',
    '2. second',
    '',
    'See [docs](https://example.test/a?b=1&c=2).',
    '',
    '```',
    'const a = "<b>";',
    '```'
  ].join('\n'));
  assert.equal(html, '<h4>Goal for Run r1</h4>'
    + '<h5>Done when</h5>'
    + '<p>AC-1. It shows <strong>bold</strong> and <em>soft</em> and <code>x &lt; y</code></p>'
    + '<ul><li>Proof: test.</li><li>Fail if: hidden</li></ul>'
    + '<ol><li>first</li><li>second</li></ol>'
    + '<p>See <a href="https://example.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a>.</p>'
    + '<pre><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>');
});

test('markdown escapes all text and drops unsafe links to plain text', async () => {
  const { renderMarkdown } = await load('markdown.js');
  const html = renderMarkdown('<img src=x onerror=alert(1)> **<script>x</script>**\n\n[click](javascript:alert(1)) [data](data:text/html,<b>) [ok](http://a.test)\n\n- <iframe>\n\n# "><svg onload=1>');
  assert.doesNotMatch(html, /<(img|script|iframe|svg)\b/);
  assert.doesNotMatch(html, /href="(javascript|data):/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; <strong>&lt;script&gt;x&lt;\/script&gt;<\/strong>/);
  assert.match(html, /<p>click data <a href="http:\/\/a\.test" [^>]*>ok<\/a><\/p>/);
  assert.match(html, /<li>&lt;iframe&gt;<\/li>/);
  assert.match(html, /<h4>&quot;&gt;&lt;svg onload=1&gt;<\/h4>/);
  assert.equal(renderMarkdown(null), '');
});

test('the Goal card has Formatted (default) and Markdown tabs with tab roles', async () => {
  const { renderDetail } = await load('detail.js');
  const detail = { summary: { ring: [] }, goalMarkdown: '# Goal\n\n- **keep** <b>this</b>', findings: null, pr: null, receipt: 'none', unconfirmed: [], extraNodes: [] };
  const html = renderDetail(detail);
  assert.match(html, /<div class="tabs" role="tablist" aria-label="Goal view">/);
  assert.match(html, /<button type="button" role="tab" id="goal-tab-formatted" aria-controls="goal-panel-formatted" aria-selected="true" tabindex="0" data-goal-view="formatted">Formatted<\/button>/);
  assert.match(html, /<button type="button" role="tab" id="goal-tab-markdown" aria-controls="goal-panel-markdown" aria-selected="false" tabindex="-1" data-goal-view="markdown">Markdown<\/button>/);
  assert.match(html, /<div role="tabpanel" id="goal-panel-formatted" aria-labelledby="goal-tab-formatted" class="goal-formatted" tabindex="0"><h4>Goal<\/h4><ul><li><strong>keep<\/strong> &lt;b&gt;this&lt;\/b&gt;<\/li><\/ul><\/div>/);
  assert.match(html, /<div role="tabpanel" id="goal-panel-markdown" aria-labelledby="goal-tab-markdown" tabindex="0" hidden><pre class="goal-text">/);
  const raw = renderDetail(detail, { goalView: 'markdown' });
  assert.match(raw, /id="goal-tab-markdown"[^>]*aria-selected="true" tabindex="0"/);
  assert.match(raw, /id="goal-panel-formatted"[^>]*hidden>/);
  assert.doesNotMatch(renderDetail({ ...detail, goalMarkdown: null }), /role="tablist"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'lib', 'studio-server.js'), 'utf8'), /\['\/js\/markdown\.js', 'js\/markdown\.js'\]/);
});

test('main.js switches Goal tabs with click, arrows, Home and End, and keeps the choice across refreshes', () => {
  const main = read('js/main.js');
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.match(main, new RegExp(`'${key}'`), key);
  assert.match(main, /state\.goalView/);
  assert.match(main, /renderDetail\(state\.detail, \{ goalView: state\.goalView \}\)/);
});

test('the header shows count chips: neutral projects, orange working with a live dot, outlined waiting', async () => {
  const { renderOverview } = await load('list.js');
  const projects = [{ state: 'working' }, { state: 'working' }, { state: 'waiting' }, { state: 'idle' }];
  const html = renderOverview(projects);
  assert.equal(html, '<li class="chip">4 projects</li>'
    + '<li class="chip chip-working"><span class="chip-dot" aria-hidden="true"></span>2 bots working</li>'
    + '<li class="chip chip-waiting">1 waiting for you</li>');
  assert.equal(renderOverview([{ state: 'idle' }]), '<li class="chip">1 project</li><li class="chip">0 bots working</li>');
  const index = read('index.html');
  assert.match(index, /<ul id="overview" class="chips" aria-label="Overview" aria-live="polite">/);
  assert.match(index, /<p id="live" class="live" data-state="connecting" role="status"><span class="live-dot" aria-hidden="true"><\/span><span class="live-text">Connecting…<\/span><\/p>/);
  const main = read('js/main.js');
  assert.match(main, /setLive\('live'\)/);
  assert.match(main, /setLive\(source\.readyState === EventSource\.CLOSED \? 'offline' : 'reconnecting'\)/);
  const css = read('styles.css');
  assert.match(css, /\.appbar\{[^}]*position:sticky;top:0[^}]*backdrop-filter:blur\(/);
  assert.match(css, /\.chip-working\{[^}]*var\(--brand/);
  assert.match(css, /\.chip-waiting\{[^}]*border-color:var\(--brand\)/);
  assert.match(css, /\.live\[data-state="live"\] \.live-dot\{background:var\(--ok-fill\)\}/);
});

test('ringModel reports the bot mode: working, waiting (with kind) or settled', async () => {
  const { ringModel } = await load('ring2d.js');
  const ring = (now) => STAGES.map((stage, index) => ({ stage, status: index < STAGES.indexOf(now) ? 'done' : stage === now ? 'now' : 'pending' }));
  assert.equal(ringModel(ring('maker'), {}).mode, 'working');
  const waiting = ringModel(ring('goal'), { waiting: { kind: 'question' } });
  assert.equal(waiting.mode, 'waiting');
  assert.equal(waiting.waitingKind, 'question');
  assert.equal(ringModel(STAGES.map((stage) => ({ stage, status: 'done' })), { state: 'DELIVERED' }).mode, 'settled');
});

test('the bot is an accessible button whose label says what it is doing', async () => {
  const { botLabel, renderRing } = await load('ring2d.js');
  const summary = (now, extra = {}) => ({ state: 'VERIFIED', ring: STAGES.map((stage, index) => ({ stage, status: index < STAGES.indexOf(now) ? 'done' : stage === now ? 'now' : 'pending' })), ...extra });
  assert.equal(botLabel(summary('review'), { total: 3, blocking: 1 }), "Bot is reviewing: Devil's Advocate, 3 findings · 1 blocking");
  assert.equal(botLabel(summary('maker'), null), 'Bot is building: Maker, in progress');
  assert.equal(botLabel(summary('goal', { waiting: { kind: 'freeze' } }), null), 'Bot is waiting for you: Waiting for Freeze');
  assert.equal(botLabel({ state: 'DELIVERED', ring: STAGES.map((stage) => ({ stage, status: 'done' })) }, null), 'Bot is done: Delivered');
  const html = renderRing({ summary: summary('review'), findings: { total: 3, blocking: 1 } });
  assert.match(html, /<div class="ring-orbit" data-at="review"><button type="button" class="bot ring-bot" aria-label="Bot is reviewing: Devil&#39;s Advocate, 3 findings · 1 blocking"><\/button><\/div>/);
});

test('bot clips: one looping clip per stage with its prop, a blinking waiting clip, and a short interruptible reaction', async () => {
  const { buildClips, REACTION_SECONDS } = await load('ring.js');
  const clips = buildClips();
  for (const stage of STAGES) {
    const clip = clips.stages[stage];
    assert.ok(clip, stage);
    const tracks = clip.tracks.map((track) => track.name);
    assert.ok(tracks.includes(`prop_${stage}.scale`), `${stage} shows its prop`);
    assert.ok(tracks.includes('body.position[y]'), `${stage} breathes`);
    for (const other of STAGES.filter((name) => name !== stage)) assert.ok(!tracks.includes(`prop_${other}.scale`), `${stage} hides ${other}`);
  }
  assert.ok(clips.waiting.tracks.some((track) => track.name === 'eyes.scale[y]'), 'waiting blinks');
  const reaction = clips.reaction;
  assert.ok(REACTION_SECONDS >= 0.6 && REACTION_SECONDS <= 0.8);
  assert.equal(reaction.duration, REACTION_SECONDS);
  const spin = reaction.tracks.find((track) => track.name === 'hop.rotation[y]');
  assert.ok(spin && Math.abs(spin.values.at(-1) - Math.PI * 2) < 1e-6, 'a full spin on Y');
  assert.ok(reaction.tracks.some((track) => track.name === 'hop.position[y]'), 'a hop');
  assert.ok(reaction.tracks.some((track) => track.name === 'face.scale[y]'), 'eyes squint');
  const review = clips.stages.review.tracks.map((track) => track.name);
  assert.ok(review.includes('sphere.material.color') && review.includes('eyeLeft.material.color'), 'Review turns the bot dark with red eyes');
  const goal = clips.stages.goal.tracks.map((track) => track.name);
  assert.ok(['quill.position', 'line1.scale', 'line2.scale', 'line3.scale'].every((name) => goal.includes(name)), 'Goal writes lines on the scroll');
});

test('bot runtime: crossfades, one paused render loop, reduced motion static, hover only on fine pointers, toned-down glow', () => {
  const ring = read('js/ring.js');
  assert.match(ring, /crossFadeTo\(/);
  assert.match(ring, /new AnimationMixer\(/);
  assert.equal((ring.match(/requestAnimationFrame\(/g) || []).length, 1);
  assert.match(ring, /document\.hidden/);
  assert.match(ring, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(ring, /if \(reducedMotion\) return/);
  assert.match(ring, /mixer\.stopAllAction\(\)/);
  assert.match(ring, /renderer\.dispose\(\)/);
  assert.doesNotMatch(ring, /#[0-9a-fA-F]{3,8}\b|0x[0-9a-fA-F]{6}\b|rgba?\(/);
  const css = read('styles.css');
  assert.doesNotMatch(css, /\.ring-gl\{[^}]*filter:/, 'no glow filter on the WebGL bot');
  assert.match(read('tokens.css'), /--shadow-bot: 0 3px 6px color-mix\(in srgb, var\(--brand\) 22%, transparent\);/);
  const main = read('js/main.js');
  assert.match(main, /ringView\.bot\.react\(\)/);
  assert.match(main, /reducedMotion: reducedMotionQuery\.matches/);
});
