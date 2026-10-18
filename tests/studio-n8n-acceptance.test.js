'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { listRecipes, loadRecipe } = require('../lib/recipe.js');
const { createStudioServer } = require('../lib/studio-server.js');
const { ElementMock, findBy, keyEvent, studioContext, waitFor } = require('./helpers/studio-dom.js');

const rootDir = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(rootDir, 'studio', 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(rootDir, 'studio', 'styles.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(rootDir, 'studio', 'index.html'), 'utf8');
const BUILTIN_IDS = ['audit', 'bugfix', 'default', 'docs-light', 'high-risk', 'refactor'];
const CANVAS_SIZES = [[1280, 800], [1600, 1000]];

function run(context, source) {
  return vm.runInContext(source, context);
}

async function withStudio(operation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-n8n-'));
  const instance = createStudioServer(root, { token: 'n8n-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const harness = studioContext(base, instance.token);
  const parts = new Map();
  harness.elements.get('scene').querySelector = (selector) => {
    if (!parts.has(selector)) parts.set(selector, new ElementMock(selector));
    return parts.get(selector);
  };
  let booted = false;
  try {
    vm.runInContext(appSource, harness.context, { filename: 'studio/app.js' });
    booted = true;
    await waitFor(() => run(harness.context, 'validationState.status') === 'valid');
    await operation({ ...harness, base, token: instance.token, parts });
  } finally {
    if (booted) run(harness.context, 'eventAbort && eventAbort.abort(); clearReconnectTimer()');
    await new Promise((resolve) => instance.server.close(resolve));
  }
}

function visibleText(html) {
  return String(html || '')
    .replace(/\s(?:title|aria-label)="[^"]*"/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldText(html, className) {
  const match = String(html || '').match(new RegExp(`class="${className}">([^<]*)<`));
  return match ? match[1] : '';
}

function classText(element) {
  return `${element?.className || ''} ${element?.attributes?.class || ''}`;
}

async function postJson(base, token, pathname, body) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: {
      'x-ael-studio-token': token,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

test('AC1 auto-layout and fit keep every builtin recipe inside the canvas', async () => {
  const listed = listRecipes(rootDir)
    .filter((item) => item.source === 'builtin')
    .map((item) => item.id);
  assert.deepEqual(listed, BUILTIN_IDS);

  await withStudio(async ({ context }) => {
    for (const id of BUILTIN_IDS) {
      const { recipe } = loadRecipe(rootDir, id);
      run(context, `recipeUnderTest = ${JSON.stringify(recipe)}`);
      const fitted = run(context, `(() => {
        draft = normalizeDraftGraph(structuredClone(recipeUnderTest));
        positions = defaultGraphPositions();
        const bounds = graphBounds();
        return ${JSON.stringify(CANVAS_SIZES)}.map(([width, height]) => {
          const next = computeFit(bounds, width, height);
          const boxes = draft.nodes.map((node) => {
            const pos = positions.get(node.id);
            return {
              id: node.id,
              left: next.x + pos.x * next.scale,
              right: next.x + (pos.x + NODE_WIDTH) * next.scale,
              top: next.y + pos.y * next.scale,
              bottom: next.y + (pos.y + NODE_BLOCK_HEIGHT) * next.scale
            };
          });
          return { width, height, scale: next.scale, count: draft.nodes.length, boxes };
        });
      })()`);

      for (const view of fitted) {
        assert.ok(view.count > 0, `${id} has nodes`);
        assert.ok(view.scale >= 0.2 && view.scale <= 2.5, `${id} scale ${view.scale} at ${view.width}x${view.height}`);
        for (const box of view.boxes) {
          assert.ok(box.left >= -0.01 && box.right <= view.width + 0.01, `${id} ${box.id} overflows horizontally at ${view.width}`);
          assert.ok(box.top >= -0.01 && box.bottom <= view.height + 0.01, `${id} ${box.id} overflows vertically at ${view.height}`);
        }
      }
    }
  });
});

test('AC2 each node renders one icon, name, status element, and duration slot', async () => {
  await withStudio(async ({ context, elements }) => {
    run(context, `catalog.live = {
      run: { createdAt: '2026-10-18T00:00:00.000Z' },
      nodes: { goal: { status: 'PASSED', updatedAt: '2026-10-18T00:00:42.000Z' } },
      edges: []
    }; renderGraph()`);
    const nodes = elements.get('nodes').children;
    assert.equal(nodes.length, run(context, 'draft.nodes.length'));
    assert.ok(nodes.length > 1);
    const goal = nodes.find((node) => node.dataset.nodeId === 'goal');
    assert.match(fieldText(goal.innerHTML, 'node-status'), /^Passed · 42s$/);
    assert.equal((goal.innerHTML.match(/42s/g) || []).length, 1);

    for (const node of nodes) {
      assert.match(node.innerHTML, /class="node-icon"[\s\S]*<svg/);
      assert.equal((node.innerHTML.match(/<svg/g) || []).length, 1);
      assert.equal((node.innerHTML.match(/class="node-name"/g) || []).length, 1);
      assert.equal((node.innerHTML.match(/class="node-status"/g) || []).length, 1);
      const visible = visibleText(node.innerHTML);
      const name = fieldText(node.innerHTML, 'node-name');
      const status = fieldText(node.innerHTML, 'node-status');
      assert.ok(name, `${node.dataset.nodeId} has a name`);
      assert.ok(status, `${node.dataset.nodeId} has a status slot`);
      assert.doesNotMatch(visible, /STAGE|STEP \d/);
      const rest = visible.replace(name, '').replace(status, '').trim();
      assert.equal(rest, '', `${node.dataset.nodeId} repeats badge text: ${rest}`);
    }
  });
});

test('AC3 edges are cubic beziers with one active edge and reduced motion off', async () => {
  assert.match(
    cssSource,
    /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\{[^}]*\.edge\.edge-active[^}]*animation:\s*none/
  );
  await withStudio(async ({ context, parts }) => {
    const target = run(context, `(() => {
      const edge = draft.edges.find((item) => item.to === 'maker');
      catalog.live = { nodes: { maker: { status: 'RUNNING' } }, edges: [] };
      renderGraph();
      return edge.to;
    })()`);
    const paths = parts.get('.edge-paths').children;
    assert.equal(paths.length, run(context, 'draft.edges.length'));
    for (const pathNode of paths) assert.match(pathNode.attributes.d, /\bC/);
    const active = paths.filter((pathNode) => /\bedge-active\b/.test(classText(pathNode)));
    const expected = run(context, `draft.edges.filter((edge) => edge.to === ${JSON.stringify(target)}).length`);
    assert.equal(expected, 1);
    assert.equal(active.length, 1);
  });
});

test('AC4 a loop group renders iteration n / max from live loopGroups', async () => {
  await withStudio(async ({ context, parts }) => {
    const label = run(context, `(() => {
      const group = draft.loopGroups[0];
      catalog.live = { loopGroups: { [group.id]: { iteration: 2, status: 'RUNNING' } }, nodes: {} };
      renderGraph();
      return 'iteration 2 / ' + group.maxIterations;
    })()`);
    const groups = parts.get('.loop-groups').children;
    assert.equal(groups.length, 1);
    assert.match(groups[0].className, /\bloop-group\b/);
    assert.match(groups[0].innerHTML, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(groups[0].innerHTML, /iteration 2 \/ /);
  });
});

test('AC5 the minimap has one rect per node and zoom controls change the viewport', async () => {
  await withStudio(async ({ context, elements }) => {
    run(context, "showWorkspace('wiring')");
    const canvas = elements.get('canvas');
    const labels = ['Zoom in', 'Zoom out', 'Fit to view', 'Auto-layout'];
    const buttons = labels.map((label) => findBy(canvas, (element) => element.attributes['aria-label'] === label));
    for (const button of buttons) {
      assert.ok(button, 'missing zoom control');
      assert.equal(button.type, 'button');
    }
    const level = findBy(canvas, (element) => element.attributes['aria-label'] === 'Zoom level');
    assert.match(level.textContent, /%$/);

    const before = run(context, 'viewport.scale');
    buttons[0].onclick({});
    const zoomed = run(context, 'viewport.scale');
    assert.ok(zoomed > before);
    assert.match(level.textContent, /%$/);
    assert.notEqual(level.textContent, '100%');
    buttons[1].onclick({});
    assert.ok(run(context, 'viewport.scale') < zoomed);

    run(context, 'viewport = { x: 240, y: 180, scale: 0.4 }');
    const expectedFit = run(context, `(() => {
      const rect = document.getElementById('canvas').getBoundingClientRect();
      return computeFit(graphBounds(), rect.width, rect.height);
    })()`);
    buttons[2].onclick({});
    const fitted = run(context, '({ x: viewport.x, y: viewport.y, scale: viewport.scale })');
    assert.equal(fitted.scale, expectedFit.scale);
    assert.ok(Math.abs(fitted.x - expectedFit.x) < 0.001);
    assert.ok(Math.abs(fitted.y - expectedFit.y) < 0.001);

    const layout = run(context, `(() => {
      const expected = Object.fromEntries(defaultGraphPositions());
      positions.set(draft.nodes[0].id, { x: 5000, y: 5000 });
      viewport = { x: 80, y: 90, scale: 0.35 };
      return expected;
    })()`);
    buttons[3].onclick({});
    assert.deepEqual(run(context, 'Object.fromEntries(positions)'), layout);
    assert.notEqual(run(context, 'viewport.scale'), 0.35);

    run(context, 'renderMinimap()');
    const minimap = findBy(canvas, (element) => element.attributes['aria-label'] === 'Workflow minimap');
    const rects = (minimap.children || []).filter((element) => /\bminimap-node\b/.test(classText(element)));
    assert.equal(rects.length, elements.get('nodes').children.length);
  });
});

test('AC6 the side panel opens Input, Output, Evidence, and Timeline tabs', async () => {
  const historyTest = fs.readFileSync(path.join(rootDir, 'tests', 'run-history.test.js'), 'utf8');
  const serverTest = fs.readFileSync(path.join(rootDir, 'tests', 'studio-server.test.js'), 'utf8');
  const historyLib = fs.readFileSync(path.join(rootDir, 'lib', 'run-history.js'), 'utf8');
  const serverLib = fs.readFileSync(path.join(rootDir, 'lib', 'studio-server.js'), 'utf8');
  assert.match(historyTest, /artifact inspection is bounded, redacted, and confined to its owning run/);
  assert.match(historyTest, /symlinkSync\(/);
  assert.match(historyTest, /REDACTED/);
  assert.match(historyTest, /super-secret-value/);
  assert.match(historyTest, /UNSAFE_HISTORY_PATH/);
  assert.match(serverTest, /\.\.\/outside/);
  assert.match(serverTest, /UNSAFE_HISTORY_PATH/);
  assert.match(historyLib, /HISTORY_ARTIFACT_TOO_LARGE/);
  assert.match(historyLib, /stat\.size > maxBytes/);
  assert.match(serverLib, /inspectRunArtifact\(/);

  await withStudio(async ({ context, elements }) => {
    run(context, "showWorkspace('wiring')");
    const panel = elements.get('node-panel');
    const node = elements.get('nodes').children[0];
    node.listeners.click[0]({ target: node, currentTarget: node, shiftKey: false, button: 0 });
    assert.equal(panel.hidden, false);
    assert.match(panel.innerHTML, /role="tablist"/);
    assert.equal((panel.innerHTML.match(/role="tab"/g) || []).length, 4);
    for (const tab of ['Overview', 'Output', 'Evidence', 'Timeline']) {
      assert.match(panel.innerHTML, new RegExp(`>${tab}<`));
    }
    assert.match(panel.innerHTML, /No run to inspect/);
  });
});

test('AC7 rewiring is validated, backbone breaks block Save, and structure stays read-only', async () => {
  const forbidden = [
    'id="delete-node"',
    'id="duplicate-node"',
    'id="apply-node"',
    'id="import-dialog"',
    'id="custom-dialog"',
    'id="create-loop-group"',
    'id="library-panel"',
    'Add node',
    'Delete node',
    'Duplicate node',
    'Import workflow',
    'Rename node',
    'createNode(',
    'deleteNode(',
    'duplicateNode(',
    '/api/import/'
  ];
  for (const source of [htmlSource, appSource]) {
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `structure affordance still present: ${token}`);
    }
  }

  await withStudio(async ({ base, token, context, elements }) => {
    assert.equal(run(context, "applyDisplayName(draft.nodes[0], 'Renamed')"), false);
    const calls = [];
    const previousFetch = context.fetch;
    context.fetch = (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET' });
      return previousFetch(url, options);
    };
    run(context, `deleteEdge(draft.edges.find((edge) => edge.to === 'delivery').id)`);
    await waitFor(() => elements.get('wiring-error').textContent.includes('delivery must depend on ASSISTED approval'));
    const error = elements.get('wiring-error').textContent;
    assert.match(error, /BACKBONE_ASSISTED_APPROVAL_REQUIRED/);
    assert.match(error, /delivery must depend on ASSISTED approval/);
    assert.equal(elements.get('save-wiring').disabled, true);
    assert.ok(calls.some((call) => call.url.includes('/api/validate') && call.method === 'POST'));

    const headers = { 'x-ael-studio-token': token };
    const loaded = await (await fetch(`${base}/api/recipe?id=default`, { headers })).json();
    const recipe = loaded.recipe;
    const broken = structuredClone(recipe);
    const deliveryEdge = broken.edges.find((edge) => edge.to === 'delivery');
    broken.edges = broken.edges.filter((edge) => edge !== deliveryEdge);
    const validated = await postJson(base, token, '/api/validate', { recipe: broken, baseRecipeId: 'default' });
    assert.equal(validated.status, 422);
    const validation = await validated.json();
    assert.ok(validation.validation.errors.includes('delivery must depend on ASSISTED approval'));

    async function assertStructure(candidate, field, nodeId) {
      for (const pathname of ['/api/validate', '/api/install']) {
        const response = await postJson(base, token, pathname, { recipe: candidate, baseRecipeId: 'default' });
        assert.equal(response.status, 400, `${pathname} ${field}`);
        const body = await response.json();
        assert.equal(body.code, 'STUDIO_STRUCTURE_READ_ONLY');
        assert.ok((body[field] || []).includes(nodeId), `${pathname} ${field} missing ${nodeId}`);
      }
    }

    const added = structuredClone(recipe);
    added.id = 'default-local';
    added.nodes.push({ id: 'extra-agent', type: 'agent' });
    await assertStructure(added, 'added', 'extra-agent');

    const removed = structuredClone(recipe);
    removed.id = 'default-local';
    removed.nodes = removed.nodes.filter((node) => node.id !== 'review');
    await assertStructure(removed, 'removed', 'review');

    const changed = structuredClone(recipe);
    changed.id = 'default-local';
    changed.nodes.find((node) => node.id === 'maker').type = 'agent';
    await assertStructure(changed, 'changed', 'maker');

    for (const pathname of ['/api/import/preview', '/api/import/apply']) {
      const response = await postJson(base, token, pathname, {});
      assert.equal(response.status, 404, pathname);
      assert.equal((await response.json()).code, 'GONE');
    }
  });
});

test('AC8 the save bar stays hidden until an edge change and Save confirms', async () => {
  const barHtml = htmlSource.slice(htmlSource.indexOf('id="wiring-bar"'), htmlSource.indexOf('id="node-panel"'));
  assert.match(barHtml, /id="wiring-count"/);
  assert.match(barHtml, /id="wiring-pill"/);
  assert.match(barHtml, /id="discard-wiring"[\s\S]*Discard/);
  assert.match(barHtml, /id="save-wiring"[\s\S]*Save wiring/);

  await withStudio(async ({ context, elements }) => {
    const bar = elements.get('wiring-bar');
    assert.equal(bar.hidden, true);
    run(context, `positions.set(draft.nodes[0].id, { x: 12, y: 24 }); renderWiringBar()`);
    assert.equal(bar.hidden, true);

    assert.equal(run(context, "addEdge('verification', 'judge')"), true);
    assert.equal(bar.hidden, false);
    assert.equal(elements.get('wiring-count').textContent, '1 wiring change');
    await waitFor(() => elements.get('save-wiring').disabled === false);
    assert.match(elements.get('wiring-pill').textContent, /^Valid /);
    assert.equal(elements.get('confirm').open, false);
    elements.get('save-wiring').onclick();
    assert.equal(elements.get('confirm').open, true);
    elements.get('confirm').close();

    elements.get('discard-wiring').onclick();
    await waitFor(() => bar.hidden === true);
    assert.equal(run(context, "draft.edges.some((edge) => edge.from === 'verification' && edge.to === 'judge')"), false);
  });
});

test('AC9 the DELIVERED summary card shows duration, tests, findings, drift, receipt, and tokens', async () => {
  await withStudio(async ({ context, elements }) => {
    const card = elements.get('run-summary-card');
    run(context, `catalog.live = { run: { state: 'RUNNING', createdAt: '2026-10-18T00:00:00.000Z' } }; renderRunSummary()`);
    assert.equal(card.hidden, true);

    run(context, `catalog.live = {
      run: {
        state: 'DELIVERED',
        createdAt: '2026-10-18T00:00:00.000Z',
        updatedAt: '2026-10-18T00:18:09.000Z'
      },
      nodes: {},
      artifacts: {
        'artifact.verification': { failed: 0, commandCount: 511 },
        'artifact.findings': { count: 2, blocking: 0 },
        'artifact.drift': { outOfMapCount: 0 },
        'artifact.receipt': { present: true, verified: true, problems: [] }
      },
      budget: { spentThisRun: 0 }
    }; renderRunSummary()`);
    assert.equal(card.hidden, false);
    assert.match(card.innerHTML, /Duration<\/span><strong>18m 09s<\/strong>/);
    assert.match(card.innerHTML, /Tests<\/span><strong>511 passed \/ 0 failed<\/strong>/);
    assert.match(card.innerHTML, /Findings<\/span><strong>2 \/ 0<\/strong>/);
    assert.match(card.innerHTML, /Drift<\/span><strong>none<\/strong>/);
    assert.match(card.innerHTML, /Receipt<\/span><strong>verified<\/strong>/);
    assert.match(card.innerHTML, /Tokens<\/span><strong>unknown<\/strong>/);

    run(context, `catalog.live.budget.totalTokens = 4200; renderRunSummary()`);
    assert.match(card.innerHTML, /Tokens<\/span><strong>4200<\/strong>/);
  });
});

test('AC10 canvas shortcuts, the ? sheet, and focus-visible styles work', async () => {
  assert.match(cssSource, /button:focus-visible[\s\S]*outline:\s*2px solid/);
  assert.match(cssSource, /\.node:focus-visible/);
  const sheetHtml = htmlSource.slice(
    htmlSource.indexOf('id="shortcut-sheet"'),
    htmlSource.indexOf('</dialog>', htmlSource.indexOf('id="shortcut-sheet"'))
  );
  for (const term of ['Fit to view', 'Auto-layout', 'Zoom in and out', 'Reset zoom to 100%', 'Arrow keys', 'Open the selected node', 'Close the panel', 'Undo and redo', '?']) {
    assert.ok(sheetHtml.includes(term), `shortcut sheet missing ${term}`);
  }

  await withStudio(async ({ context, elements, listeners }) => {
    const canvas = elements.get('canvas');
    run(context, "showWorkspace('wiring')");
    const press = (key, extras) => listeners.keydown(keyEvent(key, canvas, extras));

    run(context, 'viewport = { x: 300, y: 200, scale: 0.45 }');
    const expectedFit = run(context, `(() => {
      const rect = document.getElementById('canvas').getBoundingClientRect();
      return computeFit(graphBounds(), Math.max(0, rect.width), rect.height);
    })()`);
    press('f');
    const fitted = run(context, '({ scale: viewport.scale, x: viewport.x, y: viewport.y })');
    assert.equal(fitted.scale, expectedFit.scale);

    const laidOut = run(context, `(() => {
      const expected = Object.fromEntries(defaultGraphPositions());
      positions.set(draft.nodes[0].id, { x: 4800, y: 4800 });
      viewport = { x: 10, y: 10, scale: 0.3 };
      return expected;
    })()`);
    press('l');
    assert.deepEqual(run(context, 'Object.fromEntries(positions)'), laidOut);
    assert.notEqual(run(context, 'viewport.scale'), 0.3);

    const beforeZoom = run(context, 'viewport.scale');
    press('+');
    const zoomed = run(context, 'viewport.scale');
    assert.ok(zoomed > beforeZoom);
    press('-');
    assert.ok(run(context, 'viewport.scale') < zoomed);
    press('0');
    assert.equal(run(context, 'viewport.scale'), 1);

    run(context, 'selectedId = null; selectedIds = new Set()');
    press('ArrowRight');
    const first = run(context, 'selectedId');
    press('ArrowRight');
    const second = run(context, 'selectedId');
    assert.ok(first);
    assert.notEqual(first, second);
    press('ArrowLeft');
    assert.equal(run(context, 'selectedId'), first);
    press('ArrowUp');
    press('ArrowDown');
    assert.equal(run(context, 'selectedId'), first);

    const panel = elements.get('node-panel');
    press('Enter');
    assert.equal(panel.hidden, false);
    press('Escape');
    assert.equal(panel.hidden, true);
    press('Escape');
    assert.equal(run(context, 'selectedId'), null);

    const sheet = elements.get('shortcut-sheet');
    assert.equal(sheet.open, false);
    press('?');
    assert.equal(sheet.open, true);
    press('?');
    assert.equal(sheet.open, false);

    const edges = run(context, 'draft.edges.length');
    assert.equal(run(context, "addEdge('verification', 'judge')"), true);
    assert.equal(run(context, 'draft.edges.length'), edges + 1);
    press('z', { ctrlKey: true });
    assert.equal(run(context, 'draft.edges.length'), edges);
    press('z', { ctrlKey: true, shiftKey: true });
    assert.equal(run(context, 'draft.edges.length'), edges + 1);
    elements.get('undo').onclick();
    assert.equal(run(context, 'draft.edges.length'), edges);
    elements.get('redo').onclick();
    assert.equal(run(context, 'draft.edges.length'), edges + 1);
  });
});

test('AC11 live updates come from /api/events applyEvent with no new setInterval', async () => {
  const baselineSetInterval = 0;
  assert.equal((appSource.match(/setInterval/g) || []).length, baselineSetInterval);
  assert.match(appSource, /fetch\(`\/api\/events/);
  assert.match(appSource, /applyEvent\(parsed\.event\)/);
  assert.equal(/\brefreshLive\b/.test(appSource), false);

  await withStudio(async ({ context, elements }) => {
    const calls = [];
    const previousFetch = context.fetch;
    context.fetch = (url, options = {}) => {
      calls.push(String(url));
      return previousFetch(url, options);
    };
    const seq = run(context, 'lastEventSeq + 10');
    run(context, `showWorkspace('wiring'); catalog.live = { run: { runId: 'run-live', state: 'RUNNING' }, nodes: {} }; applyEvent({
      type: 'lifecycle',
      runId: 'run-live',
      seq: ${seq},
      payload: { events: [{ nodeId: 'maker', status: 'RUNNING', at: '2026-10-18T00:02:00.000Z' }] }
    })`);
    await waitFor(() => {
      const maker = elements.get('nodes').children.find((node) => node.dataset.nodeId === 'maker');
      return maker && maker.dataset.status === 'active';
    });
    assert.equal(calls.some((url) => url.includes('/api/live')), false);
    assert.equal(run(context, 'lastEventSeq'), seq);
  });
});

test('AC12 canvas markup has no inline styles or external assets, and edge delete is not permanent', async () => {
  assert.equal(appSource.includes('style="'), false);
  const externalUrls = [htmlSource, appSource, cssSource].flatMap((source) =>
    (source.match(/https?:\/\/[^\s"'`)]+/g) || []).filter((url) => !url.startsWith('http://www.w3.org/'))
  );
  assert.deepEqual(externalUrls, []);

  assert.match(cssSource, /\.edge-delete\{[^}]*visibility:\s*hidden/);
  assert.match(cssSource, /\.edge-delete\.visible,\.edge-delete\.selected,\.edge-delete:hover/);
  await withStudio(async ({ parts }) => {
    const controls = parts.get('.edge-controls').children.filter((element) => /\bedge-delete\b/.test(classText(element)));
    assert.ok(controls.length > 0);
    for (const control of controls) {
      assert.equal(control.className, 'edge-delete');
      assert.equal(control.attributes['aria-hidden'], 'true');
      assert.doesNotMatch(classText(control), /\bvisible\b/);
    }
  });
});

test('AC13 studio docs describe the n8n canvas and the changelog records it', () => {
  const doc = fs.readFileSync(path.join(rootDir, 'core', 'local-workflow-studio.md'), 'utf8');
  for (const heading of [
    '## Wiring canvas',
    '### Node tiles',
    '### Side panel',
    '### Tooltip',
    '### Minimap and zoom controls',
    '### Shortcuts',
    '### Save bar',
    '### Run summary card'
  ]) {
    assert.ok(doc.includes(heading), `missing heading ${heading}`);
  }
  for (const term of [
    'node tiles',
    'Input',
    'Output',
    'Evidence',
    'Timeline',
    'tooltip',
    'minimap',
    'zoom controls',
    'shortcuts',
    'dirty-only save bar',
    'run summary card',
    'read-only'
  ]) {
    assert.ok(doc.toLowerCase().includes(term.toLowerCase()), `docs missing ${term}`);
  }

  const changelog = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
  // The #88 entry starts in Unreleased and moves under a version heading at release time.
  const section = changelog.split(/^## /m).find((part) => part.includes('### Studio: n8n-style Wiring canvas (#88)'));
  assert.ok(section, 'CHANGELOG records #88');
  assert.match(section, /^(Unreleased|\d+\.\d+\.\d+ - \d{4}-\d{2}-\d{2})/);
  const entry = section.slice(section.indexOf('### Studio: n8n-style Wiring canvas (#88)')).split(/^### /m)[1];
  assert.match(entry, /\*\*Added:\*\*/);
  assert.match(entry, /\*\*Changed:\*\*/);
});
