'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const studio = path.join(__dirname, '..', 'studio');
const load = (file) => import(pathToFileURL(path.join(studio, 'js', file)).href);

const ring = (now) => ['goal', 'maker', 'verify', 'review', 'judge', 'deliver'].map((stage, index, all) => ({
  stage,
  status: index < all.indexOf(now) ? 'done' : stage === now ? 'now' : 'pending'
}));

function summary(overrides = {}) {
  return {
    runId: 'run-1',
    task: 'Add login',
    state: 'GOAL_FROZEN',
    tier: 'T2',
    iteration: 2,
    maxIterations: 3,
    stage: 'maker',
    ring: ring('maker'),
    waiting: null,
    updatedAt: '2026-11-22T10:00:00Z',
    elapsedMs: 125_000,
    ...overrides
  };
}

function project(id, state, run = summary()) {
  return { id, name: `team/${id}`, state, run: state === 'missing' ? null : run, worktreeRuns: [] };
}

function detail(overrides = {}) {
  return {
    summary: summary(),
    goalMarkdown: '# Goal\n\n- **keep** <b>this</b> as text',
    goalHash: 'abc',
    findings: { total: 3, blocking: 1 },
    pr: { branch: 'feat/login', merged: false, url: null },
    receipt: 'none',
    unconfirmed: ['Users sign in with email', 'Sessions last <24h>'],
    extraNodes: ['security-scan'],
    ...overrides
  };
}

test('render modules import in Node without touching document or window', async () => {
  for (const file of ['list.js', 'detail.js', 'api.js']) {
    const source = fs.readFileSync(path.join(studio, 'js', file), 'utf8');
    assert.doesNotMatch(source, /\b(document|window)\b/, file);
  }
  const list = await load('list.js');
  const view = await load('detail.js');
  assert.equal(typeof list.renderProjectList, 'function');
  assert.equal(typeof view.renderDetail, 'function');
  assert.equal(typeof view.renderFreezeButton, 'function');
});

test('project list orders waiting, working, idle, missing and marks the selection', async () => {
  const { renderProjectList } = await load('list.js');
  const html = renderProjectList([
    project('idle-one', 'idle'),
    project('gone', 'missing'),
    project('busy', 'working'),
    project('needs-you', 'waiting', summary({ waiting: { kind: 'freeze', since: 'x' }, stage: 'goal' }))
  ], { selectedId: 'busy' });
  const order = [...html.matchAll(/data-project-id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepStrictEqual(order, ['needs-you', 'busy', 'idle-one', 'gone']);
  assert.match(html, /data-project-id="busy"[^>]*aria-current="true"/);
  assert.doesNotMatch(html, /data-project-id="needs-you"[^>]*aria-current/);
  assert.match(html, /Freeze\?/);
  assert.match(html, /T2/);
  assert.match(html, /2m/);
});

test('project list escapes run-derived strings', async () => {
  const { renderProjectList } = await load('list.js');
  const evil = '<img src=x onerror=1>';
  const html = renderProjectList([
    { id: '"><x', name: evil, state: 'working', run: summary({ task: evil, stage: evil, tier: evil }), worktreeRuns: [summary({ task: evil })] }
  ], { selectedId: null });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /"><x/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
});

test('project list has an empty state', async () => {
  const { renderProjectList } = await load('list.js');
  assert.match(renderProjectList([], { selectedId: null }), /No projects yet/);
});

test('freeze button appears only for a freeze wait and names the actor', async () => {
  const { renderFreezeButton } = await load('detail.js');
  const waitingFreeze = summary({ waiting: { kind: 'freeze', since: 'x' } });
  assert.match(renderFreezeButton(waitingFreeze, 'Ega'), /<button[^>]*data-action="freeze"[^>]*>Freeze as Ega<\/button>/);
  assert.equal(renderFreezeButton(summary(), 'Ega'), '');
  assert.equal(renderFreezeButton(summary({ waiting: { kind: 'approval', since: 'x' } }), 'Ega'), '');
  assert.equal(renderFreezeButton(summary({ waiting: { kind: 'question', since: 'x' } }), 'Ega'), '');
  assert.equal(renderFreezeButton(null, 'Ega'), '');
  assert.match(renderFreezeButton(waitingFreeze, '<b>x</b>'), /Freeze as &lt;b&gt;x&lt;\/b&gt;/);
});

test('freeze without a valid actor asks for a name once', async () => {
  const { renderFreezeButton } = await load('detail.js');
  const html = renderFreezeButton(summary({ waiting: { kind: 'freeze', since: 'x' } }), null);
  assert.match(html, /<label for="freeze-actor">/);
  assert.match(html, /id="freeze-actor"[^>]*required/);
  assert.match(html, /data-action="freeze"/);
});

test('detail shows the Goal as text, findings, PR, receipt, assumptions and extra nodes', async () => {
  const { renderDetail } = await load('detail.js');
  const html = renderDetail(detail(), { actor: 'Ega' });
  assert.match(html, /<pre class="goal-text">[^<]*# Goal[^<]*\*\*keep\*\* &lt;b&gt;this&lt;\/b&gt; as text<\/pre>/);
  assert.doesNotMatch(html, /<b>this<\/b>/);
  assert.match(html, /3 findings, 1 blocking/);
  assert.match(html, /feat\/login/);
  assert.match(html, /No receipt yet/);
  assert.match(html, /<li>Users sign in with email<\/li>/);
  assert.match(html, /<li>Sessions last &lt;24h&gt;<\/li>/);
  assert.match(html, /security-scan/);
});

test('detail rail lists the six stages with their status', async () => {
  const { renderDetail } = await load('detail.js');
  const html = renderDetail(detail(), { actor: 'Ega' });
  const rail = html.match(/<ol class="stage-rail"[\s\S]*?<\/ol>/)[0];
  const stages = [...rail.matchAll(/data-stage="([a-z]+)" data-status="([a-z]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepStrictEqual(stages, ['goal:done', 'maker:now', 'verify:pending', 'review:pending', 'judge:pending', 'deliver:pending']);
  assert.match(rail, /Devil's Advocate|Review/);
});

test('detail handles a Run with no Goal, findings, PR or assumptions', async () => {
  const { renderDetail } = await load('detail.js');
  const html = renderDetail(detail({ goalMarkdown: null, findings: null, pr: null, receipt: 'written', unconfirmed: [], extraNodes: [] }), { actor: 'Ega' });
  assert.match(html, /No Goal draft yet/);
  assert.match(html, /No review yet/);
  assert.match(html, /No branch yet/);
  assert.match(html, /Receipt written/);
  assert.match(html, /None/);
});

test('detail only links PR urls that are http or https', async () => {
  const { renderDetail } = await load('detail.js');
  const safe = renderDetail(detail({ pr: { branch: 'b', merged: true, url: 'https://example.test/pr/1' } }), { actor: 'Ega' });
  assert.match(safe, /<a href="https:\/\/example\.test\/pr\/1"/);
  const unsafe = renderDetail(detail({ pr: { branch: 'b', merged: false, url: 'javascript:alert(1)' } }), { actor: 'Ega' });
  assert.doesNotMatch(unsafe, /<a /);
});

test('index.html loads only allowlisted files and reserves the ring', () => {
  const html = fs.readFileSync(path.join(studio, 'index.html'), 'utf8');
  assert.match(html, /<script type="module" src="\/js\/main\.js"><\/script>/);
  assert.doesNotMatch(html, /app\.js/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style|\sstyle=|\son[a-z]+=/);
  assert.match(html, /<div id="ring" aria-hidden="true"><\/div>/);
  assert.match(html, /id="project-list"/);
  assert.match(html, /id="run-detail"/);
});
