'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createStudioServer } = require('../lib/studio-server.js');
const { studioContext, waitFor, keyEvent } = require('./helpers/studio-dom.js');

async function withApp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ael-studio-gestures-'));
  const instance = createStudioServer(root, { token: 'ui-test-token', watch: false, pollMs: 60_000 });
  await new Promise((resolve, reject) => {
    instance.server.once('error', reject);
    instance.server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    const { context, elements, listeners } = studioContext(base, instance.token);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8'),
      context,
      { filename: 'studio/app.js' }
    );
    await waitFor(() => vm.runInContext('validationState.status', context) === 'valid');
    await fn({
      elements,
      listeners,
      run: (code) => vm.runInContext(code, context)
    });
  } finally {
    await new Promise((resolve) => instance.server.close(resolve));
  }
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function wheelEvent(target, extra) {
  return {
    target,
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    clientX: 200,
    clientY: 180,
    preventDefault() { this.prevented = true; },
    ...extra
  };
}

test('trackpad scroll pans, pinch zooms, and the panel still owns its wheel', async () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'studio', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'studio', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'studio', 'index.html'), 'utf8');
  assert.match(app, /addEventListener\('wheel', handleWheel, \{ passive: false \}\)/);
  assert.equal(app.includes('style="'), false);
  assert.match(css, /html\{overscroll-behavior:none\}/);
  assert.match(css, /body\{[^}]*overscroll-behavior:none/);
  assert.match(css, /\.canvas\{[^}]*overscroll-behavior:none/);
  assert.match(css, /#node-panel\{[^}]*overscroll-behavior:contain/);
  assert.match(css, /\.node-panel-body\{[^}]*overscroll-behavior:contain/);
  assert.match(css, /\.live-view\{[^}]*overscroll-behavior:contain/);
  assert.match(html, /Two-finger scroll/);
  assert.match(html, /Pinch/);
  assert.match(html, /Drag empty canvas/);
  assert.match(html, /Shift \+ drag/);
  assert.equal(html.includes('Wheel / pinch'), false);

  await withApp(async ({ elements, listeners, run }) => {
    const canvas = elements.get('canvas');
    run(`showWorkspace('wiring'); viewport = { x: 0, y: 0, scale: 1 }`);
    const wheel = canvas.listeners.wheel[0];

    const pan = wheelEvent(canvas, { deltaX: 30, deltaY: -12 });
    wheel(pan);
    const again = wheelEvent(canvas, { deltaX: 10, deltaY: 5 });
    wheel(again);
    await tick();
    assert.equal(pan.prevented, true);
    assert.equal(again.prevented, true);
    assert.equal(run('viewport.x'), -40);
    assert.equal(run('viewport.y'), 7);
    assert.equal(run('viewport.scale'), 1);

    const horizontal = wheelEvent(canvas, { deltaX: 80, deltaY: 0 });
    wheel(horizontal);
    await tick();
    assert.equal(horizontal.prevented, true);
    assert.equal(run('viewport.x'), -120);
    assert.equal(run('viewport.y'), 7);

    const line = wheelEvent(canvas, { deltaX: 3, deltaY: 0, deltaMode: 1 });
    wheel(line);
    await tick();
    assert.equal(run('viewport.x'), -168);

    run(`viewport = { x: 0, y: 0, scale: 1 }`);
    const spike = wheelEvent(canvas, { deltaY: 5000 });
    wheel(spike);
    await tick();
    assert.equal(run('viewport.y'), -240);

    run(`viewport = { x: 40, y: 60, scale: 1 }`);
    const before = run('screenToWorld(300, 220)');
    const pinch = wheelEvent(canvas, { ctrlKey: true, deltaY: 20, clientX: 300, clientY: 220 });
    wheel(pinch);
    await tick();
    const after = run('screenToWorld(300, 220)');
    assert.equal(pinch.prevented, true);
    assert.ok(run('viewport.scale') < 1);
    assert.ok(run('viewport.scale') > 0.2);
    assert.ok(Math.abs(after.x - before.x) < 0.02);
    assert.ok(Math.abs(after.y - before.y) < 0.02);

    run(`viewport = { x: 0, y: 0, scale: 1 }`);
    wheel(wheelEvent(canvas, { ctrlKey: true, deltaY: -10 }));
    await tick();
    const mild = run('viewport.scale');
    run(`viewport = { x: 0, y: 0, scale: 1 }`);
    wheel(wheelEvent(canvas, { ctrlKey: true, deltaY: -20 }));
    await tick();
    const strong = run('viewport.scale');
    assert.ok(strong > mild && mild > 1);

    run(`viewport = { x: 0, y: 0, scale: 2.5 }`);
    wheel(wheelEvent(canvas, { ctrlKey: true, deltaY: -400 }));
    await tick();
    assert.equal(run('viewport.scale'), 2.5);
    run(`viewport.scale = 0.2`);
    wheel(wheelEvent(canvas, { ctrlKey: true, deltaY: 400 }));
    await tick();
    assert.equal(run('viewport.scale'), 0.2);

    const panel = elements.get('node-panel');
    panel.closest = (selector) => String(selector).includes('#node-panel') ? panel : null;
    panel.matches = (selector) => String(selector).includes('#node-panel');
    run(`viewport = { x: 8, y: 9, scale: 1.1 }`);
    const panelWheel = wheelEvent(panel, { deltaX: 50, deltaY: 50 });
    wheel(panelWheel);
    await tick();
    assert.equal(panelWheel.prevented, undefined);
    assert.equal(run('viewport.x'), 8);
    assert.equal(run('viewport.y'), 9);
    assert.equal(run('viewport.scale'), 1.1);

    const control = {
      closest(selector) { return String(selector).includes('.zoom-controls') ? control : null; },
      matches(selector) { return String(selector).includes('.zoom-controls'); }
    };
    const controlWheel = wheelEvent(control, { deltaY: 40 });
    wheel(controlWheel);
    await tick();
    assert.equal(controlWheel.prevented, undefined);
    assert.equal(run('viewport.x'), 8);

    run(`viewport = { x: 0, y: 0, scale: 1 }`);
    canvas.listeners.gesturestart[0]({ target: canvas, preventDefault() { this.prevented = true; } });
    const gesture = { target: canvas, scale: 1.25, clientX: 100, clientY: 80, preventDefault() { this.prevented = true; } };
    canvas.listeners.gesturechange[0](gesture);
    assert.equal(gesture.prevented, true);
    assert.ok(Math.abs(run('viewport.scale') - 1.25) < 0.001);

    run(`viewport = { x: 3, y: 4, scale: 1.3 }`);
    listeners.keydown(keyEvent('0', canvas));
    assert.equal(run('viewport.scale'), 1);
    listeners.keydown(keyEvent('+', canvas));
    assert.ok(run('viewport.scale') > 1);
    listeners.keydown(keyEvent('f', canvas));
    const fitted = run(`(() => {
      const rect = document.getElementById('canvas').getBoundingClientRect();
      const expected = computeFit(graphBounds(), rect.width, rect.height);
      return Math.abs(viewport.scale - expected.scale) < 0.001;
    })()`);
    assert.equal(fitted, true);
  });
});

test('empty-canvas drag pans, a click clears selection, and shift drag marquees', async () => {
  await withApp(async ({ elements, run }) => {
    const canvas = elements.get('canvas');
    const down = canvas.listeners.pointerdown[0];
    const move = canvas.listeners.pointermove[0];
    const up = canvas.listeners.pointerup[0];
    run(`showWorkspace('wiring'); viewport = { x: 10, y: 20, scale: 1 }; selectedId = draft.nodes[0].id; selectedIds = new Set([selectedId])`);

    down({ button: 0, shiftKey: false, target: canvas, clientX: 100, clientY: 100, pointerId: 1, preventDefault() {} });
    move({ pointerId: 1, clientX: 102, clientY: 101 });
    assert.equal(run('viewport.x'), 10);
    assert.equal(run('viewport.y'), 20);
    assert.equal(run('selectedId'), null);
    move({ pointerId: 1, clientX: 140, clientY: 70 });
    assert.equal(run('viewport.x'), 50);
    assert.equal(run('viewport.y'), -10);
    up({ pointerId: 1, clientX: 140, clientY: 70 });

    run(`viewport = { x: 5, y: 6, scale: 1 }; selectedId = draft.nodes[1].id; selectedIds = new Set([selectedId])`);
    down({ button: 0, shiftKey: false, target: elements.get('scene'), clientX: 40, clientY: 40, pointerId: 2, preventDefault() {} });
    up({ pointerId: 2, clientX: 41, clientY: 40 });
    assert.equal(run('selectedId'), null);
    assert.equal(run('viewport.x'), 5);
    assert.equal(run('viewport.y'), 6);

    const spot = run(`(() => {
      const node = draft.nodes[0];
      const pos = positions.get(node.id);
      viewport = { x: 0, y: 0, scale: 1 };
      selectedId = null;
      selectedIds = new Set();
      return { id: node.id, x: pos.x, y: pos.y };
    })()`);
    down({
      button: 0,
      shiftKey: true,
      target: canvas,
      clientX: spot.x - 4,
      clientY: spot.y - 4,
      pointerId: 3,
      preventDefault() {}
    });
    move({ pointerId: 3, clientX: spot.x + 80, clientY: spot.y + 50, shiftKey: true });
    const marquee = canvas.children.find((child) => child.id === 'selection-marquee');
    assert.equal(marquee.style.display, 'block');
    assert.match(marquee.style.width, /^\d+(\.\d+)?px$/);
    assert.equal(marquee.attributes.style, undefined);
    up({ pointerId: 3, clientX: spot.x + 80, clientY: spot.y + 50 });
    assert.equal(marquee.style.display, 'none');
    assert.equal(run(`selectedIds.has(${JSON.stringify(spot.id)})`), true);

    run(`selectedId = 'keep'; selectedIds = new Set(['keep'])`);
    down({ button: 0, shiftKey: true, target: canvas, clientX: 8, clientY: 8, pointerId: 4, preventDefault() {} });
    move({ pointerId: 4, clientX: 10, clientY: 9, shiftKey: true });
    up({ pointerId: 4, clientX: 10, clientY: 9 });
    assert.equal(run('selectedId'), 'keep');

    const node = elements.get('nodes').children[0];
    node.closest = (selector) => selector === '.port' ? null : node;
    run(`viewport = { x: 15, y: 16, scale: 1 }`);
    let stopped = false;
    node.listeners.pointerdown[0]({
      button: 0,
      shiftKey: false,
      pointerId: 5,
      clientX: 30,
      clientY: 30,
      currentTarget: node,
      target: node,
      stopPropagation() { stopped = true; },
      preventDefault() {}
    });
    move({ pointerId: 5, clientX: 80, clientY: 90 });
    assert.equal(stopped, true);
    assert.equal(run('selectedId'), node.dataset.nodeId);
    assert.equal(run('viewport.x'), 15);
    assert.equal(run('viewport.y'), 16);
    up({ pointerId: 5, clientX: 80, clientY: 90 });
  });
});
