<script>
  import { untrack } from 'svelte';
  import FreezeButton from './FreezeButton.svelte';
  import { SKETCH_LABEL } from '../../js/detail.js';
  import { stageLabel } from '../../js/list.js';
  import { returnPath, stationConfig, ticketLabel } from '../../js/kitchen.js';
  import { guestPrompt, waitBubble, waitSeconds } from '../../js/mood.js';
  import { DINER_SUBTITLE, STATUS_LABELS, botLabel, dinerList, kitchenActivity, ringMode, ringModel } from '../../js/ring2d.js';

  const MOOD_TURN_MS = 3000;
  const HAS_WEBGL = typeof window !== 'undefined' && typeof window.WebGL2RenderingContext === 'function';

  let {
    summary = null,
    findings = null,
    runKey = null,
    direction = 0,
    actor = null,
    diners = [],
    crew = [],
    freeze = null,
    reducedMotion = false,
    onopen,
    onbook,
    oncrew,
    onfreeze,
    onfreezename,
    onsketch
  } = $props();

  let root = $state();
  let glEl = $state();
  let bubbleEl = $state();
  let botButton = $state();
  let gl = null;
  let glReady = $state(false);
  let ringAttr = $state('flat');
  let threeFailed = $state(false);
  let turn = $state(0);
  let moodText = $state('');

  const active = $derived(Boolean(summary));
  const base = $derived(ringModel(summary && summary.ring, summary || {}));
  const bubble = $derived(summary && summary.waiting
    ? waitBubble(summary.waiting.kind, waitSeconds(summary.waiting), turn, { reducedMotion })
    : null);
  const level = $derived(bubble ? bubble.level : 0);
  const model = $derived({ ...base, waitLevel: level });
  const activity = $derived(kitchenActivity(summary, findings));
  const back = $derived(returnPath(base));
  const prompt = $derived(guestPrompt(summary && summary.waiting));
  const guests = $derived(dinerList(diners));
  const wantsGl = $derived(active && ringMode({ webgl: HAS_WEBGL, threeFailed }) === '3d');

  $effect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') turn += 1;
    }, MOOD_TURN_MS);
    return () => window.clearInterval(timer);
  });

  $effect(() => {
    const now = level;
    untrack(() => {
      moodText = now && bubble ? `The bot says: ${bubble.text}` : '';
    });
  });

  let lastBubble = '';
  $effect(() => {
    const text = bubble ? bubble.text : '';
    untrack(() => {
      if (text === lastBubble) return;
      lastBubble = text;
      if (!text || reducedMotion || !bubbleEl) return;
      delete bubbleEl.dataset.pop;
      void bubbleEl.offsetWidth;
      bubbleEl.dataset.pop = '';
    });
  });

  $effect(() => {
    if (!wantsGl) return;
    const motion = reducedMotion;
    let cancelled = false;
    let handle = null;
    import('../../js/restaurant.js').then(({ mountKitchen }) => {
      if (cancelled) return;
      try {
        ringAttr = '3d';
        handle = mountKitchen(glEl, untrack(() => $state.snapshot(model)), {
          root,
          reducedMotion: motion,
          diners: untrack(() => guests.length),
          onOpen: () => onopen(),
          onBook: () => onbook(),
          onCrew: (id) => oncrew(id)
        });
        handle.setCrew(untrack(() => $state.snapshot(crew)));
        gl = handle;
        glReady = true;
      } catch {
        if (handle) handle.dispose();
        handle = null;
        ringAttr = 'flat';
        threeFailed = true;
      }
    }).catch(() => {
      if (cancelled) return;
      ringAttr = 'flat';
      threeFailed = true;
    });
    return () => {
      cancelled = true;
      if (handle) handle.dispose();
      gl = null;
      glReady = false;
      ringAttr = 'flat';
    };
  });

  let lastKey = null;
  $effect(() => {
    const next = $state.snapshot(model);
    const team = $state.snapshot(crew);
    const key = runKey;
    const ready = glReady;
    untrack(() => {
      const swap = lastKey !== null && lastKey !== key;
      lastKey = key;
      if (!gl || !ready) return;
      gl.update(next, { swap, direction: swap ? direction : 0 });
      gl.setCrew(team);
    });
  });

  export function zoom(to) {
    return gl ? gl.zoom(to) : Promise.resolve();
  }

  export function react() {
    if (gl) gl.react();
  }

  export function hasGl() {
    return Boolean(gl);
  }

  export function focusBot() {
    if (botButton) botButton.focus();
  }

  function botClick() {
    react();
    onopen();
  }
</script>

<section id="ring" class="ringbox" aria-label="Run loop" hidden={!active} data-bot={glReady ? '3d' : 'css'} data-ring={ringAttr} bind:this={root}>
  {#if active}
    <div class="ring-face">
      <div class="loop">
        <ol class="stages" aria-label="Kitchen stations">
          {#each base.stages as item (item.stage)}
            <li class="stage {item.status}" data-stage={item.stage} data-status={item.status} data-angle={item.angle}><i aria-hidden="true"></i><b class="stage-station">{stationConfig(item.stage).label}</b> <span class="stage-agent">{stageLabel(item.stage)}</span><span class="visually-hidden">, {STATUS_LABELS[item.status]}</span></li>
          {/each}
        </ol>
        <div class="ring-centre" aria-live="polite"><b class="ring-board" aria-hidden="true">{activity.board}</b><b class="ring-activity">{activity.title}</b><span class="eyebrow ring-note">{activity.note}</span></div>
        <p class="kitchen-ticket" data-back={back ? 'true' : 'false'}>{ticketLabel(base)}</p>
        {#if back}
          <p class="kitchen-return">{back.label}: {stationConfig(back.from).label} → {stationConfig(back.to).label}</p>
        {/if}
      </div>
      <div class="guest" data-asking={prompt ? 'true' : 'false'}>
        <p class="eyebrow guest-name">You, the guest</p>
        {#if prompt}
          <p class="guest-ask"><b>{prompt.ask}</b> <span class="guest-note">{prompt.note}</span></p>
          {#if summary.waiting.kind === 'freeze'}
            <div class="guest-actions">
              {#if summary.waiting.sketch}
                <button type="button" class="ghost" data-action="open-sketch" onclick={(event) => onsketch(event.currentTarget)}>{SKETCH_LABEL}</button>
              {/if}
              <FreezeButton {actor} source="guest" {freeze} nameAction="guest-freeze-name" {onfreeze} onname={onfreezename} />
            </div>
          {/if}
        {/if}
      </div>
      {#if guests.length}
        <ul class="visually-hidden diners" aria-label={`Diners, ${DINER_SUBTITLE.toLowerCase()}`}>
          {#each guests as diner}
            <li>{diner.name}{diner.note ? `, ${diner.note}` : ''}</li>
          {/each}
        </ul>
      {/if}
    </div>
    <div class="ring-orbit" data-at={base.botStage}><button type="button" class="bot ring-bot" aria-label={botLabel(summary, findings)} bind:this={botButton} onclick={botClick}></button><p class="bot-bubble" aria-hidden="true" hidden={!bubble} data-level={bubble ? String(bubble.level) : undefined} bind:this={bubbleEl}>{bubble ? bubble.text : ''}</p></div>
  {/if}
  <div class="ring-gl" aria-hidden="true" bind:this={glEl}></div>
  <p class="visually-hidden bot-mood" aria-live="polite">{moodText}</p>
</section>
