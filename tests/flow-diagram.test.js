'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { renderDiagram, escapeHtml } = require('../lib/flow-diagram.js');

const goal = {
  objective: 'Cancel orders & refund',
  acceptanceCriteria: [{ id: 'AC-1' }, { id: 'AC-2' }],
  flowSubject: 'order',
  flow: [
    { from: 'Paid', event: 'process', to: 'Processing', actor: 'app' },
    { from: 'Processing', event: 'cancel', to: 'Cancelled', guard: 'not shipped', actor: 'user', effects: [{ text: 'refund to wallet', ac: 'AC-2' }, { text: 'loyalty points revoked?' }] },
    { from: 'Processing', event: 'ship', to: 'Shipped', actor: 'warehouse' },
    { from: 'Shipped', event: 'cancel', to: 'Cancelled', hotspot: 'allowed after shipping?', actor: 'user' },
    { from: 'Cancelled', event: 'nightly report', to: 'Reported', actor: 'cron' }
  ],
  forbiddenTransitions: [{ from: 'Shipped', event: 'ship' }]
};

for (const view of ['state', 'storyboard', 'lanes']) {
  test(`C-27 ${view} view is a standalone page with every state, label and marker`, () => {
    const html = renderDiagram(goal, { view, revision: 3, now: new Date('2026-11-17T00:00:00Z') });
    assert.match(html, /^<!doctype html>/);
    for (const state of ['Paid', 'Processing', 'Cancelled', 'Shipped', 'Reported']) assert.ok(html.includes(state), `${view}: ${state}`);
    assert.ok(html.includes('cancel [not shipped]'), `${view}: guard label`);
    assert.match(html, /class="[^"]*\bside\b[^"]*"[^>]*>[^<]*loyalty points revoked\?/);
    assert.match(html, /class="[^"]*\bhotspot\b/);
    assert.ok(html.includes('Cancel orders &amp; refund'));
    assert.ok(html.includes('revision 3'));
    assert.ok(!/<script/i.test(html), 'no scripts');
    assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), 'no network');
  });
}

test('C-27 state view carries the transition table with undecided and invalid cells', () => {
  const html = renderDiagram(goal, { view: 'state', revision: 1 });
  assert.match(html, /<table class="transitions"/);
  assert.match(html, /class="cell undecided">\?</);
  assert.match(html, /class="cell invalid">invalid</);
  assert.match(html, /Reported/);
});

test('C-27 untrusted Goal text is escaped in every view', () => {
  const evil = { objective: '<script>alert(1)</script>', acceptanceCriteria: [{ id: 'AC-1' }], flow: [{ from: '<img src=x onerror=alert(1)>', event: '"go"', to: "B'" }] };
  for (const view of ['state', 'storyboard', 'lanes']) {
    const html = renderDiagram(evil, { view, revision: 1 });
    assert.ok(!html.includes('<script>alert'), view);
    assert.ok(!html.includes('<img src=x'), view);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), view);
  }
  assert.strictEqual(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('C-27 a one-step flow renders and an unknown view is refused', () => {
  const tiny = { objective: 'x', acceptanceCriteria: [{ id: 'AC-1' }], flow: [{ from: 'A', event: 'go', to: 'B' }] };
  for (const view of ['state', 'storyboard', 'lanes']) assert.match(renderDiagram(tiny, { view, revision: 1 }), /A/);
  assert.throws(() => renderDiagram(tiny, { view: 'pie', revision: 1 }), /state, storyboard or lanes/);
  assert.throws(() => renderDiagram({ objective: 'x' }, { view: 'state', revision: 1 }), /flow/);
});

test('C-27 review fixes: scroll hints, a full-text step list for lanes, content language', () => {
  const state = renderDiagram(goal, { view: 'state', revision: 1 });
  assert.match(state, /Scroll sideways to see the whole diagram/);
  assert.match(state, /Scroll sideways to see the whole table/);
  const lanes = renderDiagram(goal, { view: 'lanes', revision: 1, lang: 'id' });
  assert.match(lanes, /<ol class="steps">/);
  assert.ok(lanes.includes('allowed after shipping?'), 'hotspot text in full');
  assert.match(lanes, /<h1 lang="id">/);
  assert.match(renderDiagram(goal, { view: 'state', revision: 1 }), /<h1>/);
});
