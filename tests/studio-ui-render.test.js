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
  for (const file of ['list.js', 'detail.js', 'api.js', 'markdown.js']) {
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
  const order = [...html.matchAll(/class="project-row" data-project-id="([^"]+)"/g)].map((match) => match[1]);
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

test('worktree Runs render as selectable rows keyed by their escaped worktree id', async () => {
  const { renderProjectList } = await load('list.js');
  const waiting = summary({ runId: 'w1', task: 'Worktree task', worktreeId: 'wt-"1<', waiting: { kind: 'freeze', since: 'x' } });
  const html = renderProjectList([{ ...project('main', 'waiting', null), worktreeRuns: [waiting] }], { selectedId: 'wt-"1<', actor: 'Ega' });
  assert.match(html, /<button type="button" class="worktree-row" data-project-id="wt-&quot;1&lt;" aria-current="true">/);
  assert.doesNotMatch(html, /wt-"1</);
  assert.match(html, /Worktree task/);
});

test('project list offers Freeze beside rows waiting for a freeze, and only there', async () => {
  const { renderProjectList } = await load('list.js');
  const freezeWait = { kind: 'freeze', since: 'x' };
  const html = renderProjectList([
    project('needs-freeze', 'waiting', summary({ runId: 'r-main', waiting: freezeWait })),
    project('needs-approval', 'waiting', summary({ waiting: { kind: 'approval', since: 'x' } })),
    project('question', 'waiting', summary({ waiting: { kind: 'question', since: 'x' } })),
    project('busy', 'working'),
    project('quiet', 'idle'),
    { ...project('host', 'waiting', null), worktreeRuns: [summary({ runId: 'r-wt', worktreeId: 'wt-1', waiting: freezeWait })] }
  ], { selectedId: null, actor: '<b>Ega</b>' });
  const freezes = [...html.matchAll(/<button type="button" class="primary list-freeze" data-action="list-freeze" data-project-id="([^"]+)" data-run-id="([^"]+)" data-goal-hash="[^"]*" aria-label="[^"]+">Freeze as &lt;b&gt;Ega&lt;\/b&gt;<\/button>/g)]
    .map((match) => `${match[1]}:${match[2]}`);
  assert.deepStrictEqual(freezes.sort(), ['needs-freeze:r-main', 'wt-1:r-wt']);
  assert.equal((html.match(/data-action="list-freeze"/g) || []).length, 2);
  assert.doesNotMatch(html, /<button[^>]*class="project-row"[^>]*>(?:(?!<\/button>)[\s\S])*data-action="list-freeze"/, 'Freeze is not nested in the row button');
});

test('list Freeze carries the escaped draft hash it was rendered with and names its target', async () => {
  const { renderProjectList } = await load('list.js');
  const html = renderProjectList([
    { ...project('p"1', 'waiting', summary({ runId: 'r-main', waiting: { kind: 'freeze', since: 'x', goalHash: 'h"<1' } })), name: 'team/<a>' },
    { ...project('host', 'waiting', null), worktreeRuns: [summary({ runId: 'r-wt', task: 'Fix "login"', worktreeId: 'wt-1', waiting: { kind: 'freeze', since: 'x', goalHash: 'h2' } })] }
  ], { selectedId: null, actor: 'Ega <b>' });
  assert.match(html, /data-run-id="r-main" data-goal-hash="h&quot;&lt;1" aria-label="Freeze team\/&lt;a&gt; as Ega &lt;b&gt;">/);
  assert.match(html, /data-run-id="r-wt" data-goal-hash="h2" aria-label="Freeze Fix &quot;login&quot; as Ega &lt;b&gt;">/);
  assert.doesNotMatch(html, /h"<1/);
  const nameless = renderProjectList([project('p', 'waiting', summary({ waiting: { kind: 'freeze', since: 'x', goalHash: 'h' } }))], { actor: null });
  assert.match(nameless, /aria-label="Freeze team\/p">Freeze…<\/button>/);
});

test('a finished worktree Run shows an idle bot, not a working one', async () => {
  const { renderProjectList, worktreeState } = await load('list.js');
  const done = summary({ runId: 'w-done', worktreeId: 'wt-done', state: 'DELIVERED', stage: null });
  const live = summary({ runId: 'w-live', worktreeId: 'wt-live' });
  const waiting = summary({ runId: 'w-wait', worktreeId: 'wt-wait', waiting: { kind: 'question', since: 'x' } });
  const html = renderProjectList([{ ...project('host', 'working', null), worktreeRuns: [done, live, waiting] }], {});
  assert.match(html, /<li class="worktree-run" data-state="idle"><button type="button" class="worktree-row" data-project-id="wt-done"><span class="bot bot-idle"/);
  assert.match(html, /<li class="worktree-run" data-state="working"><button type="button" class="worktree-row" data-project-id="wt-live"><span class="bot bot-working"/);
  assert.equal(worktreeState(done), 'idle');
  assert.equal(worktreeState(summary({ state: 'REPORTED' })), 'idle');
  assert.equal(worktreeState(live), 'working');
  assert.equal(worktreeState(waiting), 'waiting');
});

test('list Freeze without a valid actor asks for a name in the Run view', async () => {
  const { renderProjectList } = await load('list.js');
  const html = renderProjectList([project('needs-freeze', 'waiting', summary({ waiting: { kind: 'freeze', since: 'x' } }))], { selectedId: null, actor: null });
  assert.match(html, /data-action="list-freeze"[^>]*>Freeze…<\/button>/);
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

test('detail has no stage rail; the stage overlay shows eyebrow, title, start time and a compact wait with Freeze', async () => {
  const { renderDetail, renderRunHead } = await load('detail.js');
  assert.doesNotMatch(renderDetail(detail(), { actor: 'Ega' }), /stage-rail/);
  const head = renderRunHead(summary({ task: 'Add login <b>', waiting: { kind: 'freeze', since: 'x' } }), { actor: 'Ega', projectName: 'team/app' });
  assert.match(head, /^<p class="eyebrow">team\/app · T2 · iteration 2 of 3<\/p><h2 class="run-task" title="Add login &lt;b&gt;">Add login &lt;b&gt;<\/h2><p class="run-meta">Started 2m ago<\/p>/);
  assert.match(head, /<div class="stage-wait" data-kind="freeze"><span class="chip chip-waiting">Freeze\?<\/span><span class="visually-hidden">[^<]+<\/span><button type="button" class="primary" data-action="freeze">Freeze as Ega<\/button><\/div>$/);
  const approval = renderRunHead(summary({ waiting: { kind: 'approval', since: 'x' } }), { actor: 'Ega' });
  assert.match(approval, /<span class="chip chip-waiting">Approve delivery\?<\/span>/);
  assert.doesNotMatch(approval, /data-action="freeze"/);
  assert.doesNotMatch(renderRunHead(summary(), {}), /stage-wait/);
});

test('the Run view is one screen: stage overlay, Details button with a D shortcut, and a modal bottom sheet', () => {
  const html = fs.readFileSync(path.join(studio, 'index.html'), 'utf8');
  assert.match(html, /<header id="run-head" class="stage-head"><\/header>/);
  assert.match(html, /<button type="button" id="details-open" class="details-button" aria-haspopup="dialog" aria-controls="details-sheet" aria-keyshortcuts="d" hidden>Details <kbd aria-hidden="true">D<\/kbd><\/button>/);
  assert.match(html, /<div id="details-sheet" class="sheet" role="dialog" aria-modal="true" aria-labelledby="details-title" hidden>/);
  assert.match(html, /<h2 id="details-title" class="sheet-title">Run details<\/h2>/);
  assert.match(html, /<button type="button" class="sheet-close" data-action="close-details" aria-label="Close details">Close<\/button>/);
  assert.match(html, /<div class="sheet-panel" tabindex="-1">[\s\S]*<div id="run-detail" class="run-detail"><\/div>/);
  assert.match(html, /<button type="button" id="projects-toggle" class="projects-toggle" aria-expanded="false" aria-controls="projects">Projects<\/button>/);
  const css = fs.readFileSync(path.join(studio, 'styles.css'), 'utf8');
  assert.match(css, /body\{[^}]*height:100dvh[^}]*overflow:hidden/, 'no page scroll: the stage fills the screen');
  assert.match(css, /\.sheet-panel\{[^}]*transform:translateY\(100%\);transition:transform 450ms cubic-bezier\(\.32,\.72,0,1\)\}/);
  assert.match(css, /body\[data-sheet="open"\] \.run\{transform:scale\(\.985\)\}/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion:reduce)'));
  assert.match(reduced, /\.sheet-panel\{opacity:0;transform:none;transition:opacity 200ms/, 'reduced motion: the sheet fades');
  const main = fs.readFileSync(path.join(studio, 'js', 'main.js'), 'utf8');
  assert.match(main, /event\.key === 'd' \|\| event\.key === 'D'/);
  assert.match(main, /sheet\.open\(elements\.detailsButton\)/);
});

test('sheet rules: dismiss after a quarter of the height or a fast flick, rubber-band upward, focus stays inside', async () => {
  const { shouldDismiss, dragOffset, trapFocus } = await load('sheet.js');
  assert.equal(shouldDismiss(50, 0.1, 400), false);
  assert.equal(shouldDismiss(120, 0.1, 400), true);
  assert.equal(shouldDismiss(30, 0.9, 400), true);
  assert.equal(shouldDismiss(-40, 2, 400), false);
  assert.equal(dragOffset(40), 40);
  assert.ok(dragOffset(-100) > -100 && dragOffset(-100) < 0);
  const focused = [];
  const first = { focus: () => focused.push('first'), closest: () => null };
  const last = { focus: () => focused.push('last'), closest: () => null };
  const container = { ownerDocument: { activeElement: last }, contains: () => true, querySelectorAll: () => [first, last] };
  let prevented = false;
  assert.equal(trapFocus({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } }, container), true);
  assert.deepStrictEqual(focused, ['first']);
  assert.ok(prevented);
  assert.equal(trapFocus({ key: 'a' }, container), false);
});

test('list bots: working orange, waiting outlined, idle grey; freeze waits read "name · Freeze?"', async () => {
  const { renderProjectList } = await load('list.js');
  const html = renderProjectList([
    project('busy', 'working'),
    project('quiet', 'idle'),
    project('needs-freeze', 'waiting', summary({ stage: 'goal', waiting: { kind: 'freeze', since: 'x' } })),
    project('needs-approval', 'waiting', summary({ stage: 'deliver', waiting: { kind: 'approval', since: 'x' } })),
    { ...project('host', 'waiting', null), worktreeRuns: [summary({ runId: 'r-wt', task: 'Wt task', worktreeId: 'wt-1', waiting: { kind: 'freeze', since: 'x' } })] }
  ], { selectedId: 'busy' });
  assert.match(html, /data-project-id="busy" aria-current="true"><span class="bot bot-working" role="img" aria-label="Working"><\/span><span class="row-name">team\/busy<\/span>/);
  assert.match(html, /<span class="bot bot-idle" role="img" aria-label="Idle"><\/span><span class="row-name">team\/quiet<\/span>/);
  assert.match(html, /<span class="bot bot-waiting" role="img" aria-label="Waiting for you"><\/span><span class="row-name">team\/needs-freeze <span class="row-ask">· Freeze\?<\/span><\/span><span class="row-meta">Goal · T2 · 2m<\/span>/);
  assert.match(html, /<span class="row-name">team\/needs-approval<\/span><span class="row-meta">Approve delivery\? · T2 · 2m<\/span>/);
  assert.match(html, /<span class="worktree-task">Wt task <span class="row-ask">· Freeze\?<\/span><\/span>/);
  assert.equal((html.match(/data-action="list-freeze"/g) || []).length, 2, 'the sibling Freeze button stays');
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
  assert.match(html, /<section id="ring" class="ringbox" aria-label="Run loop" hidden><\/section>/);
  assert.ok(html.indexOf('id="ring"') < html.indexOf('id="run-head"'), 'the ring card comes first, as in option C');
  assert.match(html, /id="project-list"/);
  assert.match(html, /id="run-detail"/);
});
