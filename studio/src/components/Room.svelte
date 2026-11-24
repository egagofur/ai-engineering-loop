<script>
  import FreezeButton from './FreezeButton.svelte';
  import { roomFacts } from '../../js/detail.js';
  import { waitingLabel } from '../../js/list.js';
  import { ringActivity } from '../../js/ring2d.js';
  import { trapFocus } from '../../js/sheet.js';

  let { visible = false, opened = false, summary = null, findings = null, projectName = '', actor = null, freeze = null, onclose, onstep, onfreeze, onfreezename, onreact, closeButton = $bindable(null) } = $props();

  let root;
  const activity = $derived(summary ? ringActivity(summary, findings) : null);

  function keydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onstep(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onstep(-1);
    } else {
      trapFocus(event, root);
    }
  }

  function click(event) {
    if (!event.target.closest('[data-action]') && !event.target.closest('.room-card')) onreact();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_interactive_supports_focus -->
<div id="room" class="room" role="dialog" aria-modal="true" aria-labelledby="room-title" hidden={!visible} data-open={visible ? String(opened) : undefined} bind:this={root} onkeydown={keydown} onclick={click}>
  <div class="room-card">
    {#if visible && summary}
      <p class="eyebrow">{projectName}</p>
      <h2 id="room-title" class="room-title">{summary.task || summary.runId}</h2>
      <p class="room-activity"><strong>{activity.title}</strong> · {activity.note}</p>
      <div class="room-facts">
        {#each roomFacts(summary) as fact}
          <span class="chip">{fact}</span>
        {/each}
      </div>
      {#if summary.waiting}
        <div class="stage-wait">
          <span class="chip chip-waiting">{waitingLabel(summary.waiting)}</span>
          {#if summary.waiting.kind === 'freeze'}
            <FreezeButton {actor} source="room" {freeze} nameAction="room-freeze-name" {onfreeze} onname={onfreezename} />
          {/if}
        </div>
      {/if}
    {/if}
  </div>
  <div class="room-nav">
    <button type="button" data-action="room-prev" aria-keyshortcuts="ArrowLeft" onclick={() => onstep(-1)}>← Previous</button>
    <button type="button" data-action="room-close" aria-keyshortcuts="Escape" bind:this={closeButton} onclick={onclose}>Close</button>
    <button type="button" data-action="room-next" aria-keyshortcuts="ArrowRight" onclick={() => onstep(1)}>Next →</button>
  </div>
</div>
