<script>
  import { onMount, tick, untrack } from 'svelte';
  import Overview from './components/Overview.svelte';
  import ProjectList from './components/ProjectList.svelte';
  import RunHead from './components/RunHead.svelte';
  import RunDetail from './components/RunDetail.svelte';
  import Ring from './components/Ring.svelte';
  import Room from './components/Room.svelte';
  import Sheet from './components/Sheet.svelte';
  import Sketch from './components/Sketch.svelte';
  import OrderBook from './components/OrderBook.svelte';
  import { diagramUrl, fetchDetail, fetchMe, fetchProjects, fetchRuns, freezeGoal, saveActor } from '../js/api.js';
  import { crewLabel, crewRuns, withLiveOrders } from '../js/orders.js';
  import { sortProjects, worktreeState } from '../js/list.js';
  import { recommendedView, sketchOptions, waitsForFreeze } from '../js/detail.js';
  import { ringModel } from '../js/ring2d.js';
  import { roomTargets, stepTarget, waitLevel, waitSeconds } from '../js/mood.js';

  const ELAPSED_REFRESH_MS = 60_000;
  const ROOM_FADE_MS = 260;
  const FREEZE_DONE_MS = 650;
  const LIVE_TEXT = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', offline: 'Offline' };

  let projects = $state.raw([]);
  let loaded = $state(false);
  let selectedId = $state(null);
  let detail = $state.raw(null);
  let detailError = $state(null);
  let me = $state.raw({ actor: null, actorValid: false, diners: [] });
  let goalView = $state('formatted');
  let status = $state('');
  let connection = $state('');
  let live = $state('connecting');
  let projectsOpen = $state(false);
  let reducedMotion = $state(false);
  let freeze = $state.raw({ source: null, phase: 'idle' });
  let sheet = $state(null);
  let sheetOpener = $state.raw(null);
  let orders = $state.raw({ runs: [], loading: false, error: null });
  let sketch = $state.raw({ key: null, view: null, frames: [], ids: null });
  let room = $state({ visible: false, opened: false });
  let zoom = $state(undefined);
  let ringDirection = $state(0);
  let held = $state.raw(null);

  let detailKey = null;
  let detailTicket = 0;
  let ordersTicket = 0;
  let pendingSketch = null;
  let sketchWarm = null;
  let roomOpen = false;
  let roomBusy = false;
  let narrowQuery = null;

  let runEl;
  let ring;
  let actorInput = $state(null);
  let detailsButton = $state(null);
  let ordersButton = $state(null);
  let projectsToggle;
  let roomClose = $state(null);

  const actor = $derived(me.actorValid ? me.actor : null);
  const targets = $derived(projects.flatMap((project) => [
    project,
    ...(project.worktreeRuns || []).filter((run) => run.worktreeId).map((run) => ({
      id: run.worktreeId,
      name: `${project.name} · worktree`,
      state: worktreeState(run),
      run
    }))
  ]));
  const project = $derived(targets.find((target) => target.id === selectedId) || null);
  const current = $derived(project && project.run && detail ? { project, detail } : null);
  const view = $derived(current || (project && project.run && !detail && !detailError ? held : null));
  const crew = $derived(view
    ? crewRuns(projects, selectedId).map(({ id, run }) => ({ id, label: crewLabel(run), model: crewModel(run) }))
    : []);
  const sketchUrl = $derived(sketch.ids ? (name) => diagramUrl(sketch.ids.projectId, sketch.ids.runId, name, sketch.ids.goalHash) : () => '');

  $effect(() => {
    if (current) held = current;
    else if (!(project && project.run && !detailError)) held = null;
  });

  $effect(() => {
    if (view) return;
    sheet = null;
  });

  $effect(() => {
    document.body.dataset.sheet = sheet ? 'open' : 'closed';
  });

  $effect(() => {
    void detail;
    void project;
    untrack(syncSketch);
  });

  function crewModel(run) {
    const model = ringModel(run.ring, run);
    model.waitLevel = run.waiting ? waitLevel(waitSeconds(run.waiting)) : 0;
    return model;
  }

  function runKey(target) {
    const run = target && target.run;
    return run ? [target.id, run.runId, run.state, run.updatedAt, run.stage, run.waiting && run.waiting.kind].join('|') : null;
  }

  function emptyMessage() {
    if (!loaded) return 'Loading projects…';
    if (!project) return projects.length ? 'Pick a project to see its Run.' : 'No projects yet.';
    if (project.state === 'missing') return 'This project folder is missing.';
    if (!project.run) return 'No active Run in this project.';
    if (detailError) return `Could not load this Run: ${detailError}`;
    return 'Loading Run…';
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function openSheet(name, opener) {
    sheetOpener = opener || null;
    sheet = name;
  }

  function closeSheet() {
    sheet = null;
  }

  function playEnter() {
    if (!runEl) return;
    delete runEl.dataset.enter;
    void runEl.offsetWidth;
    runEl.dataset.enter = '';
  }

  async function loadDetail({ enter = false } = {}) {
    const target = project;
    detailKey = runKey(target);
    const ticket = ++detailTicket;
    if (!target || !target.run) {
      detail = null;
      detailError = null;
      return;
    }
    try {
      const next = await fetchDetail(target.id, target.run.runId);
      if (ticket !== detailTicket) return;
      detail = next;
      detailError = null;
    } catch (error) {
      if (ticket !== detailTicket) return;
      detail = null;
      detailError = error.message;
    }
    await tick();
    if (enter && !ring.hasGl()) playEnter();
    if (pendingSketch && pendingSketch === selectedId && detail) {
      pendingSketch = null;
      openSketch(null);
    }
  }

  function applyProjects(list) {
    projects = Array.isArray(list) ? list : [];
    loaded = true;
    const previous = selectedId;
    if (!project) {
      const first = sortProjects(projects)[0];
      selectedId = first ? first.id : null;
    }
    const changed = previous !== selectedId;
    if (changed || runKey(project) !== detailKey) {
      if (changed) detail = null;
      loadDetail({ enter: changed || !detail });
    }
  }

  function select(id, { direction = 0 } = {}) {
    if (!id || id === selectedId) return;
    ringDirection = direction;
    selectedId = id;
    detail = null;
    detailError = null;
    status = '';
    const url = new URL(window.location.href);
    url.searchParams.set('project', id);
    window.history.replaceState(null, '', url);
    loadDetail({ enter: true });
  }

  async function refreshProjects() {
    try {
      applyProjects(await fetchProjects());
    } catch (error) {
      connection = error.message;
    }
  }

  function freezeFailure(error) {
    if (error.code === 'GOAL_DRAFT_CONFLICT') return 'The Goal changed since you opened it. The new draft is shown; read it and freeze again.';
    return error.fix ? `${error.message}. ${error.fix}` : error.message;
  }

  async function submitFreeze(targetId, runId, expectedHash) {
    const result = await freezeGoal(targetId, runId, expectedHash);
    status = result.alreadyFrozen ? 'This Goal was already frozen in the agent host.' : `Goal frozen as ${me.actor}.`;
  }

  async function withFreezeLock(source, operation) {
    if (freeze.phase !== 'idle') return;
    freeze = { source, phase: 'busy' };
    try {
      await operation();
      freeze = { source, phase: 'done' };
      await wait(reducedMotion ? 0 : FREEZE_DONE_MS);
    } catch (error) {
      freeze = { source: null, phase: 'idle' };
      status = freezeFailure(error);
    }
    await refreshProjects();
    await loadDetail();
    freeze = { source: null, phase: 'idle' };
  }

  async function freezeGoalDraft(source, name) {
    const target = project;
    const draft = detail;
    if (!target || !draft || !draft.goalHash) {
      status = 'There is no Goal draft to freeze. Reload the page.';
      return;
    }
    await withFreezeLock(source, async () => {
      if (name !== undefined) me = await saveActor(name);
      await submitFreeze(target.id, draft.summary.runId, draft.goalHash);
    });
  }

  async function freezeFromList(targetId, run) {
    select(targetId);
    if (!actor) {
      status = 'Type your name under the Goal to freeze it.';
      return;
    }
    const goalHash = run.waiting && run.waiting.goalHash;
    if (!goalHash) {
      status = 'There is no Goal draft to freeze. Reload the page.';
      return;
    }
    await withFreezeLock(`list:${targetId}`, () => submitFreeze(targetId, run.runId, goalHash));
  }

  function askForName(targetId) {
    select(targetId);
    status = 'Type your name under the Goal to freeze it.';
  }

  function focusActorInput() {
    if (actorInput) actorInput.focus();
  }

  function sketchTarget() {
    if (!project || !detail || !sketchOptions(detail).length) return null;
    return { project, detail, key: [project.id, detail.summary.runId, detail.goalHash].join('|') };
  }

  function prepareSketch() {
    const target = sketchTarget();
    if (!target) return false;
    if (target.key !== sketch.key) {
      const first = recommendedView(target.detail);
      sketch = { key: target.key, view: first, frames: [first], ids: { projectId: target.project.id, runId: target.detail.summary.runId, goalHash: target.detail.goalHash } };
    } else if (!sketch.frames.includes(sketch.view)) {
      sketch = { ...sketch, frames: [...sketch.frames, sketch.view] };
    }
    return true;
  }

  function syncSketch() {
    const target = sketchTarget();
    if (!target) {
      if (sheet === 'sketch') closeSheet();
      return;
    }
    if (sheet === 'sketch' || waitsForFreeze(target.detail.summary) || target.key === sketch.key) prepareSketch();
  }

  function warmSketchTabs() {
    const target = sketchTarget();
    if (!target || sketchWarm === target.key) return;
    sketchWarm = target.key;
    const idle = window.requestIdleCallback || ((run) => window.setTimeout(run, 200));
    idle(() => {
      if (sketch.key !== target.key) return;
      const all = sketchOptions(target.detail).map((option) => option.view);
      sketch = { ...sketch, frames: [...sketch.frames, ...all.filter((name) => !sketch.frames.includes(name))] };
    });
  }

  function showSketchView(name) {
    if (!sketchTarget()) return;
    sketch = { ...sketch, view: name, frames: sketch.frames.includes(name) ? sketch.frames : [...sketch.frames, name] };
  }

  function openSketch(opener) {
    if (!detail || !sketchOptions(detail).length) {
      status = 'There is no order sketch for this Goal right now.';
      return;
    }
    if (roomOpen) return;
    prepareSketch();
    openSheet('sketch', opener);
    warmSketchTabs();
  }

  function listSketch(id, opener) {
    if (id === selectedId && detail) openSketch(opener);
    else {
      pendingSketch = id;
      select(id);
    }
  }

  function sketchName() {
    closeSheet();
    focusActorInput();
  }

  async function openOrders(opener) {
    const target = project;
    if (!target || sheet) return;
    const ticket = ++ordersTicket;
    orders = { runs: [], loading: true, error: null };
    openSheet('orders', opener);
    try {
      const runs = await fetchRuns(target.id);
      if (ticket === ordersTicket) orders = { runs: withLiveOrders(runs, crewRuns(projects, selectedId)), loading: false, error: null };
    } catch (error) {
      if (ticket === ordersTicket) orders = { runs: [], loading: false, error: error.message };
    }
  }

  async function openRoom() {
    if (roomOpen || roomBusy || !view) return;
    roomBusy = true;
    roomOpen = true;
    zoom = 'in';
    room.visible = true;
    await tick();
    if (roomClose) void roomClose.offsetWidth;
    room.opened = true;
    if (roomClose) roomClose.focus();
    await ring.zoom('in');
    roomBusy = false;
  }

  async function closeRoom() {
    if (!roomOpen || roomBusy) return;
    roomBusy = true;
    room.opened = false;
    const zoomOut = ring.zoom('out');
    await wait(reducedMotion ? 0 : ROOM_FADE_MS);
    room.visible = false;
    zoom = undefined;
    roomOpen = false;
    ring.focusBot();
    await zoomOut;
    roomBusy = false;
  }

  function roomStep(direction) {
    if (roomBusy) return;
    const id = stepTarget(roomTargets(projects), selectedId, direction);
    if (!id || id === selectedId) return;
    select(id, { direction });
  }

  function roomName() {
    closeRoom().then(focusActorInput);
  }

  function selectRow(id) {
    select(id);
    if (narrowQuery && narrowQuery.matches) projectsOpen = false;
  }

  function typingTarget(target) {
    return Boolean(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function keydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typingTarget(event.target)) return;
    if (event.key === 'Escape' && projectsOpen) {
      projectsOpen = false;
      projectsToggle.focus();
      return;
    }
    if (roomOpen || sheet || !view) return;
    if (event.key === 'o' || event.key === 'O') {
      event.preventDefault();
      openOrders(ordersButton);
    } else if (event.key === 'd' || event.key === 'D') {
      event.preventDefault();
      openSheet('details', detailsButton);
    }
  }

  function connect() {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => {
      live = 'live';
    });
    source.addEventListener('projects', (event) => {
      connection = '';
      live = 'live';
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      applyProjects(payload.projects);
    });
    source.addEventListener('error', () => {
      const closed = source.readyState === EventSource.CLOSED;
      live = closed ? 'offline' : 'reconnecting';
      connection = closed ? 'Lost the Studio connection. Start `ael studio` again, then reload this page.' : 'Reconnecting to Studio…';
    });
    return source;
  }

  onMount(() => {
    selectedId = new URLSearchParams(window.location.search).get('project');
    narrowQuery = window.matchMedia('(max-width: 899px)');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = motionQuery.matches;
    const onMotion = () => {
      reducedMotion = motionQuery.matches;
    };
    motionQuery.addEventListener('change', onMotion);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshProjects();
    }, ELAPSED_REFRESH_MS);
    let source = null;
    let stopped = false;
    (async () => {
      try {
        me = await fetchMe();
      } catch {
        me = { actor: null, actorValid: false, diners: [] };
      }
      await refreshProjects();
      if (!stopped) source = connect();
    })();
    return () => {
      stopped = true;
      window.clearInterval(refresh);
      motionQuery.removeEventListener('change', onMotion);
      if (source) source.close();
    };
  });
</script>

<svelte:window onkeydown={keydown} />

<header class="appbar">
  <div class="brand">
    <b class="mark" aria-hidden="true"><span class="mark-eye"></span><span class="mark-eye"></span></b>
    <h1 class="title">AEL <span class="title-sub">Studio</span></h1>
  </div>
  <button type="button" id="projects-toggle" class="projects-toggle" aria-expanded={projectsOpen ? 'true' : 'false'} aria-controls="projects" bind:this={projectsToggle} onclick={() => (projectsOpen = !projectsOpen)}>Projects</button>
  <Overview {projects} {loaded} />
  <p id="live" class="live" data-state={live} role="status"><span class="live-dot" aria-hidden="true"></span><span class="live-text">{LIVE_TEXT[live]}</span></p>
  <p id="connection" class="connection" role="alert" hidden={!connection}>{connection}</p>
</header>
<main class="layout">
  <nav id="projects" class="projects" aria-labelledby="projects-title" data-open={projectsOpen ? 'true' : 'false'}>
    <h2 id="projects-title" class="section-title">Projects</h2>
    <ProjectList {projects} {loaded} {selectedId} {actor} {freeze} onselect={selectRow} onsketch={listSketch} onfreeze={freezeFromList} onfreezename={askForName} />
  </nav>
  <section id="run" class="run" aria-label="Selected Run" data-showing={view ? 'true' : 'false'} data-zoom={zoom} bind:this={runEl}>
    <p id="run-empty" class="empty" hidden={Boolean(view)}>{view ? '' : emptyMessage()}</p>
    <Ring
      bind:this={ring}
      summary={view ? view.detail.summary : null}
      findings={view ? view.detail.findings : null}
      runKey={view ? `${view.project.id}|${view.detail.summary.runId}` : null}
      direction={ringDirection}
      {actor}
      diners={me.diners || []}
      {crew}
      {freeze}
      {reducedMotion}
      onopen={openRoom}
      onbook={() => openOrders(null)}
      oncrew={(id) => select(id)}
      onfreeze={(source) => freezeGoalDraft(source)}
      onfreezename={focusActorInput}
      onsketch={openSketch}
    />
    <RunHead summary={view ? view.detail.summary : null} {actor} projectName={view ? view.project.name : ''} {freeze} bind:actorInput onfreeze={(source, name) => freezeGoalDraft(source, name)} onsketch={openSketch} />
    <p id="run-status" class="run-status" role="status">{status}</p>
    <button type="button" id="orders-open" class="details-button orders-button" aria-haspopup="dialog" aria-controls="orders-sheet" aria-keyshortcuts="o" aria-expanded={sheet === 'orders' ? 'true' : 'false'} hidden={!view} bind:this={ordersButton} onclick={() => openOrders(ordersButton)}>Order book <kbd aria-hidden="true">O</kbd></button>
    <button type="button" id="details-open" class="details-button" aria-haspopup="dialog" aria-controls="details-sheet" aria-keyshortcuts="d" aria-expanded={sheet === 'details' ? 'true' : 'false'} hidden={!view} bind:this={detailsButton} onclick={() => openSheet('details', detailsButton)}>Details <kbd aria-hidden="true">D</kbd></button>
    <Room
      visible={room.visible}
      opened={room.opened}
      summary={view ? view.detail.summary : null}
      findings={view ? view.detail.findings : null}
      projectName={view ? view.project.name : ''}
      {actor}
      {freeze}
      bind:closeButton={roomClose}
      onclose={closeRoom}
      onstep={roomStep}
      onfreeze={(source) => freezeGoalDraft(source)}
      onfreezename={roomName}
      onreact={() => ring.react()}
    />
  </section>
</main>
<Sheet id="sketch-sheet" className="sheet sketch-sheet" titleId="sketch-title" title="Order sketch" closeLabel="Close order sketch" open={sheet === 'sketch'} opener={sheetOpener} onclose={closeSheet}>
  <Sketch detail={view ? view.detail : null} sketchKey={sketch.key} view={sketch.view} frames={sketch.frames} urlFor={sketchUrl} {actor} {freeze} onview={showSketchView} onfreeze={(source) => freezeGoalDraft(source)} onfreezename={sketchName} />
</Sheet>
<Sheet id="orders-sheet" className="sheet orders-sheet" titleId="orders-title" title="Order book" closeLabel="Close order book" open={sheet === 'orders'} opener={sheetOpener} onclose={closeSheet}>
  <OrderBook runs={orders.runs} projectName={project ? project.name : ''} loading={orders.loading} error={orders.error} />
</Sheet>
<Sheet id="details-sheet" className="sheet" titleId="details-title" title="Run details" closeLabel="Close details" open={sheet === 'details'} opener={sheetOpener} onclose={closeSheet}>
  <RunDetail detail={view ? view.detail : null} {goalView} onview={(name) => (goalView = name)} />
</Sheet>
