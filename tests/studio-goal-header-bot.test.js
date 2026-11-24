'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const studio = path.join(__dirname, '..', 'studio');
const load = (file) => import(pathToFileURL(path.join(studio, 'js', file)).href);
const read = (file) => fs.readFileSync(path.join(studio, file), 'utf8');
const { renderComponent } = require('./helpers/svelte.js');
const renderDetail = (detail, { goalView = 'formatted' } = {}) => renderComponent('components/RunDetail.svelte', { detail, goalView });
const renderRing = ({ summary = null, findings = null } = {}) => renderComponent('components/Ring.svelte', { summary, findings, freeze: { source: null, phase: 'idle' } });
const stripOverview = (html) => html.replace(/^<ul id="overview"[^>]*>/, '').replace(/<\/ul>$/, '');
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
  const detail = { summary: { ring: [] }, goalMarkdown: '# Goal\n\n- **keep** <b>this</b>', findings: null, pr: null, receipt: 'none', unconfirmed: [], extraNodes: [] };
  const html = await renderDetail(detail);
  assert.match(html, /<div class="tabs" role="tablist" aria-label="Goal view">/);
  assert.match(html, /<button type="button" role="tab" id="goal-tab-formatted" aria-controls="goal-panel-formatted" aria-selected="true" tabindex="0" data-goal-view="formatted">Formatted<\/button>/);
  assert.match(html, /<button type="button" role="tab" id="goal-tab-markdown" aria-controls="goal-panel-markdown" aria-selected="false" tabindex="-1" data-goal-view="markdown">Markdown<\/button>/);
  assert.match(html, /<div role="tabpanel" id="goal-panel-formatted" aria-labelledby="goal-tab-formatted" class="goal-formatted" tabindex="0"><h4>Goal<\/h4><ul><li><strong>keep<\/strong> &lt;b&gt;this&lt;\/b&gt;<\/li><\/ul><\/div>/);
  assert.match(html, /<div role="tabpanel" id="goal-panel-markdown" aria-labelledby="goal-tab-markdown" tabindex="0" hidden=""><pre class="goal-text">/);
  const raw = await renderDetail(detail, { goalView: 'markdown' });
  assert.match(raw, /id="goal-tab-markdown"[^>]*aria-selected="true" tabindex="0"/);
  assert.match(raw, /id="goal-panel-formatted"[^>]*hidden="">/);
  assert.doesNotMatch(await renderDetail({ ...detail, goalMarkdown: null }), /role="tablist"/);
});

test('Goal tabs switch with click, arrows, Home and End, and the choice lives in the app so refreshes keep it', () => {
  const tabs = read('src/tabs.js');
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.match(tabs, new RegExp(`${key}:`), key);
  const detail = read('src/components/RunDetail.svelte');
  assert.match(detail, /onclick=\{\(\) => onview\(name\)\}/);
  assert.match(detail, /tabKeys\(event, GOAL_VIEWS, name\)/);
  const app = read('src/App.svelte');
  assert.match(app, /let goalView = \$state\('formatted'\)/);
  assert.match(app, /<RunDetail detail=\{view \? view\.detail : null\} \{goalView\} onview=\{\(name\) => \(goalView = name\)\} \/>/);
});

test('the header shows count chips: neutral projects, orange working with a live dot, outlined waiting', async () => {
  const projects = [{ state: 'working' }, { state: 'working' }, { state: 'waiting' }, { state: 'idle' }];
  const overview = (list) => renderComponent('components/Overview.svelte', { projects: list, loaded: true }).then(stripOverview);
  const html = await overview(projects);
  assert.equal(html, '<li class="chip">4 kitchens</li>'
    + '<li class="chip chip-working"><span class="chip-dot" aria-hidden="true"></span>2 chefs cooking</li>'
    + '<li class="chip chip-waiting">1 order needs you</li>');
  assert.equal(await overview([{ state: 'idle' }]), '<li class="chip">1 kitchen</li><li class="chip">0 chefs cooking</li>');
  const index = await renderComponent('App.svelte');
  assert.match(index, /<ul id="overview" class="chips" aria-label="Overview" aria-live="polite">/);
  assert.match(index, /<p id="live" class="live" data-state="connecting" role="status"><span class="live-dot" aria-hidden="true"><\/span><span class="live-text">Connecting…<\/span><\/p>/);
  const main = read('src/App.svelte');
  assert.match(main, /live = 'live';/);
  assert.match(main, /const closed = source\.readyState === EventSource\.CLOSED;\n\s+live = closed \? 'offline' : 'reconnecting';/);
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
  const { botLabel } = await load('ring2d.js');
  const summary = (now, extra = {}) => ({ state: 'VERIFIED', ring: STAGES.map((stage, index) => ({ stage, status: index < STAGES.indexOf(now) ? 'done' : stage === now ? 'now' : 'pending' })), ...extra });
  assert.equal(botLabel(summary('review'), { total: 3, blocking: 1 }), "Bot is reviewing: Devil's Advocate, 3 findings · 1 blocking");
  assert.equal(botLabel(summary('maker'), null), 'Bot is building: Maker, in progress');
  assert.equal(botLabel(summary('goal', { waiting: { kind: 'freeze' } }), null), 'Bot is waiting for you: Waiting for Freeze');
  assert.equal(botLabel({ state: 'DELIVERED', ring: STAGES.map((stage) => ({ stage, status: 'done' })) }, null), 'Bot is done: Delivered');
  const html = await renderRing({ summary: summary('review'), findings: { total: 3, blocking: 1 } });
  assert.match(html, /<div class="ring-orbit" data-at="review"><button type="button" class="bot ring-bot" aria-label="Bot is reviewing: Devil's Advocate, 3 findings · 1 blocking"><\/button><p class="bot-bubble" aria-hidden="true" hidden=""><\/p><\/div>/);
});

test('bot clips: one looping clip per stage with its prop, a blinking waiting clip, and a short interruptible reaction', async () => {
  const { buildClips, REACTION_SECONDS } = await load('bot.js');
  const clips = buildClips();
  for (const stage of STAGES) {
    const clip = clips.stages[stage];
    assert.ok(clip, stage);
    const tracks = clip.tracks.map((track) => track.name);
    assert.ok(tracks.includes(`prop_${stage}.scale`), `${stage} shows its prop`);
    assert.ok(tracks.includes('body.position[y]'), `${stage} breathes`);
    for (const other of STAGES.filter((name) => name !== stage)) assert.ok(!tracks.includes(`prop_${other}.scale`), `${stage} hides ${other}`);
  }
  assert.ok(clips.waiting[0].tracks.some((track) => track.name === 'face.rotation[y]'), 'waiting looks around');
  const { EYE_SHAPES } = await load('bot.js');
  assert.ok(['open', 'happy', 'question', 'angry', 'squint'].every((shape) => EYE_SHAPES.includes(shape)), 'eyes change shape by mood');
  assert.match(read('js/bot.js'), /BLINK_SECONDS/, 'the eyes blink');
  const reaction = clips.reaction;
  assert.ok(REACTION_SECONDS >= 0.6 && REACTION_SECONDS <= 0.8);
  assert.equal(reaction.duration, REACTION_SECONDS);
  const spin = reaction.tracks.find((track) => track.name === 'hop.rotation[y]');
  assert.ok(spin && Math.abs(spin.values.at(-1) - Math.PI * 2) < 1e-6, 'a full spin on Y');
  assert.ok(reaction.tracks.some((track) => track.name === 'hop.position[y]'), 'a hop');
  assert.ok(reaction.tracks.some((track) => track.name === 'hop.scale'), 'squash and stretch');
  const review = clips.stages.review.tracks.map((track) => track.name);
  assert.ok(review.includes('body.rotation[z]') && review.includes('face.rotation[z]'), 'Review tilts, thinking');
  const goal = clips.stages.goal.tracks.map((track) => track.name);
  assert.ok(goal.includes('prop_goal.rotation[z]') && goal.includes('face.rotation[x]'), 'Goal writes with the quill, looking down');
  const track = (stage, name) => clips.stages[stage].tracks.find((item) => item.name === name);
  const food = track('maker', 'pan_food.position[y]');
  assert.ok(Math.max(...food.values) - food.values[0] > 0.25 && food.values.at(-1) === food.values[0], 'Maker tosses the food up out of the pan and it lands back');
  assert.ok(Math.abs(track('maker', 'pan_food.rotation[x]').values.at(-1) + Math.PI * 2) < 1e-6, 'the food flips once per toss');
  assert.ok(Math.min(...track('maker', 'prop_maker.rotation[x]').values) < -0.3, 'the pan flicks its front edge up');
  assert.ok(Math.max(...track('judge', 'body.rotation[x]').values) > 0.15, 'the Head chef leans in over the plate');
  const taste = track('judge', 'prop_judge.position').values;
  const heights = taste.filter((_, index) => index % 3 === 1);
  assert.ok(Math.min(...heights) < 0.15 && Math.max(...heights) > 0.4, 'the spoon dips into the plate, then up to taste');
  assert.ok(track('judge', 'face.rotation[x]').values.filter((value) => value > 0.2).length >= 3, 'a nod after tasting');
});

test('bot runtime: crossfades, one paused render loop, reduced motion static, hover only on fine pointers, toned-down glow', () => {
  const bot = read('js/bot.js');
  const ring = read('js/restaurant.js');
  assert.match(bot, /crossFadeTo\(/);
  assert.match(bot, /new AnimationMixer\(/);
  assert.equal((bot.match(/requestAnimationFrame\(/g) || []).length, 0, 'the bot steps inside the ring loop');
  assert.equal((ring.match(/requestAnimationFrame\(/g) || []).length, 1);
  assert.match(ring, /document\.hidden/);
  assert.match(ring, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(bot, /if \(reducedMotion\) return false;/, 'reduced motion: no reaction motion');
  assert.match(bot, /mixer\.stopAllAction\(\)/);
  assert.match(ring, /renderer\.dispose\(\)/);
  for (const source of [bot, ring]) assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|0x[0-9a-fA-F]{6}\b|rgba?\(/);
  const css = read('styles.css');
  assert.doesNotMatch(css, /\.ring-gl\{[^}]*filter:/, 'no glow filter on the WebGL bot');
  assert.match(read('tokens.css'), /--shadow-bot: 0 3px 6px color-mix\(in srgb, var\(--brand\) 22%, transparent\);/);
  const main = read('src/components/Ring.svelte');
  assert.match(main, /if \(gl\) gl\.react\(\);/);
  assert.match(bot, /new MeshPhysicalMaterial\(\{ roughness: 0\.32, metalness: 0, clearcoat: 1/, 'clearcoat shell');
  assert.match(bot, /costume === 'devil'/);
  assert.match(bot, /costume === 'philosopher'/);
  assert.match(bot, /new SphereGeometry\(R, 64, 48\)/, 'one smooth sphere body');
  assert.doesNotMatch(bot, /visorMesh|armR|armL|neck/, 'no visor, arms or neck');
  assert.doesNotMatch(bot, /gavel|hammer|spatula/i, 'no gavel or hammer: the chef cooks and tastes');
  assert.match(bot, /targets\.chef = 1 - targets\.devil;/, 'the toque stays on at every station; only the Critic swaps it for a beret');
  assert.match(bot, /costume_devil_hat/);
  assert.match(bot, /const eyeSurface = material\(new MeshBasicMaterial\(\)\);/, 'flat unlit eyes, no blobby highlights');
  assert.match(main, /reducedMotion: motion,/);
  assert.match(read('src/App.svelte'), /reducedMotion = motionQuery\.matches;/);
});

test('round bot: capsule eyes right of centre carry the moods, blink with jitter and squash on hops', async () => {
  const { eyePose, nextBlink, EYE_YAW, EYE_GAP, BLINK_SECONDS, BOT_HEIGHT } = await load('bot.js');
  assert.ok(EYE_YAW > 0 && EYE_YAW - EYE_GAP / 2 > 0, 'both eyes sit right of centre, looking sideways');
  assert.equal(BOT_HEIGHT, 1, 'a unit sphere');
  const open = eyePose('open');
  assert.deepStrictEqual(open.left, { sx: 1, sy: 1, rz: -0, dy: 0, lid: 1, slope: 0 });
  assert.equal(open.arcs, false);
  assert.ok(eyePose('open', 0).left.sy < 0.1, 'a blink closes the lids');
  assert.ok(eyePose('squint').left.sy < 0.4 && eyePose('squint').left.sy < eyePose('squint').right.sy, 'a narrow, lopsided suspicious squint');
  const angry = eyePose('angry');
  assert.ok(angry.left.lid < 0.5 && angry.left.slope > 0.5, 'angry lids slant down toward the nose');
  assert.ok(eyePose('question').left.slope < 0, 'worried lids slant the other way');
  assert.ok(eyePose('focus').left.lid < 1 && eyePose('stern').left.lid < eyePose('focus').left.lid, 'focused and serious faces lower the lids');
  const { eyeOutline } = await load('bot.js');
  const top = (pose, side) => Math.max(...eyeOutline(pose, side).map(([, y]) => y));
  const edge = (pose, side, sign) => eyeOutline(pose, side).filter(([x]) => Math.sign(x) === sign).reduce((most, [, y]) => Math.max(most, y), -1);
  assert.ok(top(angry.left, -1) < top(open.left, -1), 'the lid cuts the top of the capsule');
  assert.ok(edge(angry.left, -1, 1) < edge(angry.left, -1, -1), 'left eye: inner corner lower when angry');
  assert.ok(edge(angry.right, 1, -1) < edge(angry.right, 1, 1), 'right eye: inner corner lower when angry');
  assert.ok(eyePose('wide').left.sy > 1 && eyePose('question').mark, 'wide "?" eyes show a question mark');
  assert.equal(eyePose('happy').arcs, true, 'happy shows ^ ^');
  assert.equal(eyePose('happy', 0.2).arcs, false);
  assert.ok(BLINK_SECONDS <= 0.2);
  assert.equal(nextBlink(() => 0), 2.6);
  assert.ok(nextBlink(() => 1) <= 6, 'blinks every few seconds with jitter');
  const { stride } = await load('kitchen.js');
  assert.deepStrictEqual(stride(0.5, false), { y: 1, xz: 1 });
  assert.ok(stride(0, true).y < 1, 'squash on landing');
  assert.ok(stride(1, true).y > 1, 'stretch at the top of the hop');
  for (const lift of [0, 0.3, 1]) {
    const shape = stride(lift, true);
    assert.ok(Math.abs(shape.y * shape.xz * shape.xz - 1) < 0.01, 'volume is kept');
  }
  const restaurant = read('js/restaurant.js');
  assert.match(restaurant, /bot\.stride\(lift, progress < 1\)/, 'the bot squashes and stretches while hopping between stations');
  assert.match(restaurant, /wakeTimer = window\.setTimeout\(schedule, wait \* 1000/, 'an idle scene wakes only to blink');
});

test('micro-interactions: station hover lift, Judge bell ding, diners glance at the bot, all off for reduced motion', async () => {
  const { dinerGlance, GLANCE_PERIOD, GLANCE_SECONDS } = await load('kitchen.js');
  assert.equal(dinerGlance(GLANCE_SECONDS + 0.1, 0), 0);
  assert.ok(dinerGlance(GLANCE_SECONDS / 2, 0) === 1, 'a full glance in the middle of the window');
  assert.ok(dinerGlance(0.05, 0) > 0 && dinerGlance(0.05, 0) < 1, 'eases in');
  assert.ok(GLANCE_PERIOD > GLANCE_SECONDS * 4, 'occasionally');
  const restaurant = read('js/restaurant.js');
  assert.match(restaurant, /const outcome = reducedMotion \? null : judgeOutcome\(before, current\.statuses\);/);
  assert.match(restaurant, /if \(outcome === 'pass'\) dingAt = elapsed;/, 'a pass rings the bell');
  assert.match(restaurant, /if \(outcome === 'iterate'\) pushAt = elapsed;/, 'an iterate pushes the plate back toward Cook');
  const { judgeOutcome } = await load('kitchen.js');
  assert.equal(judgeOutcome({ judge: 'now' }, { judge: 'done' }), 'pass');
  assert.equal(judgeOutcome({ judge: 'now' }, { judge: 'pending' }), 'iterate');
  assert.equal(judgeOutcome({ judge: 'now' }, { judge: 'now' }), null);
  assert.equal(judgeOutcome({ judge: 'pending' }, { judge: 'done' }), null);
  assert.match(restaurant, /if \(glances\) setHovered\(stationUnder\(event\)\);/);
  assert.match(restaurant, /const glances = finePointer\.matches && !reducedMotion;/);
  const diners = read('js/diners.js');
  assert.match(diners, /const look = bot && !reducedMotion \? dinerGlance\(seconds, figure\.phase\) : 0;/);
  const css = read('styles.css');
  assert.match(css, /\.stage\[data-hover="true"\]/, 'the hovered station label lights up');
  const main = read('src/App.svelte');
  assert.match(main, /await operation\(\);\n\s+freeze = \{ source, phase: 'done' \};\n\s+await wait\(reducedMotion \? 0 : FREEZE_DONE_MS\);/, 'a successful Freeze morphs the button before the view refreshes');
});
