'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { createRun } = require('../lib/run-state.js');
const { saveGoalDraft, loadGoalDraft } = require('../lib/goal-runtime.js');
const { createStudioServer } = require('../lib/studio-server.js');
const { projectId } = require('../lib/studio/instance.js');

const TOKEN = 'sketch-test-token';
const studio = path.join(__dirname, '..', 'studio');
const load = (file) => import(pathToFileURL(path.join(studio, 'js', file)).href);

const FLOW = [
  { from: 'Paid', event: 'cancel', to: 'Cancelled', effects: [{ text: 'refund', ac: 'AC-1' }, { text: 'points?' }] },
  { from: 'Paid', event: 'ship', to: 'Shipped', hotspot: true },
  { from: 'Shipped', event: 'deliver', to: 'Done', effects: [{ text: 'email' }] }
];

function setup({ flow = FLOW, workflow = null } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ael-sketch-')));
  const home = path.join(base, 'home');
  const root = path.join(base, 'repo');
  fs.mkdirSync(path.join(home, '.ai-engineering-loop'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ai-engineering-loop', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-engineering-loop', 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ path: root }] }));
  fs.writeFileSync(path.join(home, '.ai-engineering-loop', 'config.json'), JSON.stringify({ studioActor: 'Ega' }));
  if (workflow) fs.writeFileSync(path.join(root, '.ai-engineering-loop', 'workflow.md'), workflow);
  const runId = 'run-sketch';
  createRun(root, { runId, task: 'cancel orders' });
  const goal = {
    schemaVersion: 1,
    runId,
    objective: 'Cancel paid orders',
    acceptanceCriteria: [{ id: 'AC-1', statement: 'cancel works', evidenceRequired: 'test', failureCases: ['shipped order cancels'] }],
    ...(flow ? { flowSubject: 'order', flow } : {})
  };
  saveGoalDraft(root, runId, goal, { actor: 'agent', expectedRevision: 0 });
  return { home, root, runId, id: projectId(root), hash: loadGoalDraft(root, runId).metadata.contentHash };
}

async function withStudio(home, operation) {
  const instance = createStudioServer({ home, token: TOKEN, pollMs: 60_000 });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  try {
    await operation(`http://127.0.0.1:${instance.server.address().port}`);
  } finally {
    await instance.close();
  }
}

const get = (base, route, headers = { 'x-ael-studio-token': TOKEN }) => fetch(`${base}${route}`, { headers });

test('the goal diagram route renders the draft under its own sandboxed CSP and never writes a file', async () => {
  const { home, root, runId, id } = setup();
  await withStudio(home, async (base) => {
    const route = `/api/projects/${id}/runs/${runId}/goal/diagram`;
    assert.equal((await get(base, `${route}?view=state`, {})).status, 401, 'needs the Studio session');
    for (const view of ['state', 'storyboard', 'lanes']) {
      const response = await get(base, `${route}?view=${view}`);
      assert.equal(response.status, 200, view);
      assert.match(response.headers.get('content-type'), /^text\/html/);
      const html = await response.text();
      assert.match(html, /Cancel paid orders/);
      assert.doesNotMatch(html, /<script|\sstyle="|\son[a-z]+="/, 'no scripts or inline style attributes');
      const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
      const hash = crypto.createHash('sha256').update(style).digest('base64');
      const csp = response.headers.get('content-security-policy');
      assert.equal(csp, `default-src 'none'; style-src 'sha256-${hash}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox`);
    }
    assert.equal((await get(base, `${route}?view=state`)).headers.get('cache-control'), 'no-store');
    const detail = (await (await get(base, `/api/projects/${id}/runs/${runId}`)).json()).detail;
    assert.ok(detail.goalHash);
    const cached = await get(base, `${route}?view=state&rev=${encodeURIComponent(detail.goalHash)}`);
    assert.equal(cached.status, 200);
    assert.equal(cached.headers.get('cache-control'), 'private, max-age=3600, immutable', 'a URL pinned to the current draft hash is cacheable');
    assert.equal((await get(base, `${route}?view=state&rev=stale`)).headers.get('cache-control'), 'no-store', 'a stale hash is never cached');
    assert.equal((await get(base, `${route}?view=gantt`)).status, 400);
    assert.equal((await get(base, route)).status, 400);
    assert.equal((await get(base, `/api/projects/${id}/runs/nope-run/goal/diagram?view=state`)).status, 404);
    assert.equal((await get(base, `/api/projects/missing/runs/${runId}/goal/diagram?view=state`)).status, 404);
    assert.equal((await fetch(`${base}${route}?view=state`, { method: 'POST', headers: { 'x-ael-studio-token': TOKEN, 'content-type': 'application/json' }, body: '{}' })).status, 405);
  });
  assert.equal(fs.existsSync(path.join(root, '.ai-engineering-loop', 'runs', runId, 'diagrams')), false, 'read-only: no diagrams folder');
});

test('the diagram route is 404 without a flow, without a draft, or with freeze_diagram off', async () => {
  const noFlow = setup({ flow: null });
  await withStudio(noFlow.home, async (base) => {
    const response = await get(base, `/api/projects/${noFlow.id}/runs/${noFlow.runId}/goal/diagram?view=state`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'GOAL_DIAGRAM_NOT_FOUND');
  });
  const off = setup({ workflow: '# Workflow\n\n- **freeze_diagram**: off\n' });
  await withStudio(off.home, async (base) => {
    assert.equal((await get(base, `/api/projects/${off.id}/runs/${off.runId}/goal/diagram?view=state`)).status, 404);
    const detail = (await (await get(base, `/api/projects/${off.id}/runs/${off.runId}`)).json()).detail;
    assert.equal(detail.diagramOptions, undefined);
  });
  const empty = setup();
  createRun(empty.root, { runId: 'run-empty', task: 'nothing drafted' });
  await withStudio(empty.home, async (base) => {
    assert.equal((await get(base, `/api/projects/${empty.id}/runs/run-empty/goal/diagram?view=state`)).status, 404);
  });
});

test('the run detail carries diagramOptions and flow counts only while the draft waits for freeze', async () => {
  const { home, root, runId, id } = setup({ workflow: '# Workflow\n\n- **freeze_diagram**: lanes\n' });
  await withStudio(home, async (base) => {
    const detail = (await (await get(base, `/api/projects/${id}/runs/${runId}`)).json()).detail;
    assert.equal(detail.summary.waiting.kind, 'freeze');
    assert.equal(detail.summary.waiting.sketch, true);
    assert.deepEqual(detail.diagramOptions.map((option) => option.view), ['lanes', 'state', 'storyboard'], 'the project default comes first');
    assert.equal(detail.diagramOptions[0].recommended, true);
    assert.deepEqual(detail.flowCounts, { undecided: 3, hotspots: 1, sideEffects: 2 });
    const projects = (await (await get(base, '/api/projects')).json()).projects;
    assert.equal(projects[0].run.waiting.sketch, true);
  });
  const file = path.join(root, '.ai-engineering-loop', 'runs', runId, 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...state, state: 'GOAL_FROZEN' }));
  await withStudio(home, async (base) => {
    const detail = (await (await get(base, `/api/projects/${id}/runs/${runId}`)).json()).detail;
    assert.equal(detail.summary.waiting, null);
    assert.equal(detail.diagramOptions, undefined);
    assert.equal(detail.flowCounts, undefined);
  });
});

test('the order sketch sheet: tabs recommended first, counts, no Revise button, Freeze on the same hash path', async () => {
  const { renderSketch, sketchCounts, sketchFrame, recommendedView, REVISE_HINT, renderRunHead } = await load('detail.js');
  const detail = {
    diagramOptions: [
      { view: 'state', recommended: true, reason: 'the Goal changes the status of order' },
      { view: 'storyboard', recommended: false, reason: 'every step is a user action' },
      { view: 'lanes', recommended: false, reason: 'steps run across user, job' }
    ],
    flowCounts: { undecided: 3, hotspots: 1, sideEffects: 2 }
  };
  const html = renderSketch(detail, { actor: 'Ega' });
  assert.match(html, /<p class="sketch-counts">3 undecided, 1 hotspot, 2 side effects<\/p>/);
  const tabs = [...html.matchAll(/data-sketch-view="([a-z]+)"[^>]*>([A-Za-z]+)/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(tabs, ['state:State', 'storyboard:Storyboard', 'lanes:Lanes']);
  assert.match(html, /aria-selected="true" tabindex="0" data-sketch-view="state"[^>]*>State <span class="tab-note">Recommended<\/span>/);
  assert.match(html, /<div id="sketch-panel" class="sketch-panel" role="tabpanel" aria-labelledby="sketch-tab-state" aria-busy="true" data-loaded="false"><div class="sketch-skeleton" aria-hidden="true">/, 'the sheet opens on a skeleton');
  assert.doesNotMatch(html, /<iframe/, 'frames are added lazily, one per visited tab');
  assert.equal(sketchFrame('state', '/diagram?view=state&rev=h'), '<iframe class="sketch-frame" title="State sketch of the Goal" sandbox="" referrerpolicy="no-referrer" data-view="state" src="/diagram?view=state&amp;rev=h"></iframe>');
  assert.equal(recommendedView(detail), 'state');
  assert.equal(recommendedView({ diagramOptions: [{ view: 'lanes' }, { view: 'state', recommended: true }] }), 'state');
  assert.match(html, /data-action="freeze">Freeze as Ega<\/button>/);
  assert.ok(html.includes(REVISE_HINT));
  assert.equal(REVISE_HINT, 'To change the Goal, answer Revise in your agent host.');
  assert.doesNotMatch(html, />Revise</, 'no Revise button in Studio');
  assert.match(renderSketch(detail, { view: 'lanes' }), /aria-selected="true" tabindex="0" data-sketch-view="lanes"/);
  assert.match(renderSketch(detail, {}), /data-action="sketch-freeze-name">Freeze…<\/button>/);
  assert.match(renderSketch({}, {}), /no order sketch/);
  assert.equal(sketchCounts({ undecided: 1, hotspots: 2, sideEffects: 1 }), '1 undecided, 2 hotspots, 1 side effect');
  const summary = { runId: 'r', task: 't', ring: [], waiting: { kind: 'freeze', since: 'x', goalHash: 'h', sketch: true } };
  assert.match(renderRunHead(summary, { actor: 'Ega' }), /Freeze as Ega<\/button><button type="button" class="ghost" data-action="open-sketch">Look at the order sketch<\/button>/);
  assert.doesNotMatch(renderRunHead({ ...summary, waiting: { ...summary.waiting, sketch: false } }, { actor: 'Ega' }), /open-sketch/);
  const { renderGuest } = await load('ring2d.js');
  assert.match(renderGuest({ summary, actor: 'Ega' }), /data-action="open-sketch">Look at the order sketch<\/button><button type="button" class="primary" data-action="freeze">Freeze as Ega/);
  const { renderProjectList } = await load('list.js');
  const list = renderProjectList([{ id: 'p', name: 'shop', state: 'waiting', run: { ...summary, state: 'STARTED' } }], { actor: 'Ega' });
  assert.match(list, /data-action="list-freeze"[^>]*data-goal-hash="h"/);
  assert.match(list, /<button type="button" class="ghost list-sketch" data-action="list-sketch" data-project-id="p" aria-label="Look at the order sketch for shop">Sketch<\/button>/);
  const index = fs.readFileSync(path.join(studio, 'index.html'), 'utf8');
  assert.match(index, /<div id="sketch-sheet" class="sheet sketch-sheet" role="dialog" aria-modal="true" aria-labelledby="sketch-title" hidden>/);
  const main = fs.readFileSync(path.join(studio, 'js', 'main.js'), 'utf8');
  assert.match(main, /diagramUrl\(target\.project\.id, target\.detail\.summary\.runId, view, target\.detail\.goalHash\)/, 'frame URLs carry the draft hash so the browser can cache them');
  assert.match(main, /if \(sketchSheet\.isOpen\(\) \|\| waitsForFreeze\(target\.detail\)/, 'the recommended view is prepared while the Run waits for Freeze');
  assert.match(main, /if \(action\.dataset\.action === 'freeze'\) freeze\(undefined, action\);/, 'the sheet Freeze uses the same expectedHash path');
});
