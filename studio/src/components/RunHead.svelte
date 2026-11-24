<script>
  import FreezeButton from './FreezeButton.svelte';
  import { SKETCH_LABEL, startedText, waitAsk, waitText, waitsForFreeze } from '../../js/detail.js';
  import { waitingLabel } from '../../js/list.js';
  import { ringEyebrow } from '../../js/ring2d.js';

  let { summary = null, actor = null, projectName = '', freeze = null, onfreeze, onsketch, actorInput = $bindable(null) } = $props();

  let name = $state('');
  const title = $derived(summary ? summary.task || summary.runId : '');
  const busy = $derived(freeze && freeze.source === 'head' && freeze.phase === 'busy');
  const done = $derived(freeze && freeze.source === 'head' && freeze.phase === 'done');

  function submit(event) {
    event.preventDefault();
    const typed = name.trim();
    if (typed) onfreeze('head', typed);
  }
</script>

<header id="run-head" class="stage-head">
  {#if summary}
    <p class="eyebrow">{ringEyebrow(summary, projectName)}</p>
    <h2 class="run-task" {title}>{title}</h2>
    <p class="run-meta">{startedText(summary.elapsedMs)}</p>
    {#if summary.waiting}
      <div class="stage-wait" data-kind={summary.waiting.kind}><span class="chip chip-waiting" title={waitingLabel(summary.waiting)}>{waitAsk(summary.waiting)}</span><span class="visually-hidden">{waitText(summary.waiting)}</span>{#if waitsForFreeze(summary)}{#if actor}<FreezeButton {actor} source="head" {freeze} {onfreeze} onname={() => {}} />{:else}<form class="freeze-form" data-action="freeze" onsubmit={submit}><label for="freeze-actor">Your name</label><input id="freeze-actor" name="actor" type="text" autocomplete="name" maxlength="80" required bind:value={name} bind:this={actorInput}><button type="submit" class="primary" data-action="freeze" disabled={busy} data-done={done ? 'true' : undefined}>{busy ? 'Freezing…' : done ? 'Frozen' : 'Freeze'}</button></form>{/if}{#if summary.waiting.sketch}<button type="button" class="ghost" data-action="open-sketch" onclick={(event) => onsketch(event.currentTarget)}>{SKETCH_LABEL}</button>{/if}{/if}</div>
    {/if}
  {/if}
</header>
