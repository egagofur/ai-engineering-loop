<script>
  import { overviewChips } from '../../js/list.js';

  let { projects = [], loaded = false } = $props();
  const chips = $derived(overviewChips(projects));
</script>

<ul id="overview" class="chips" aria-label="Overview" aria-live="polite">
  {#if !loaded}
    <li class="chip">Loading projects…</li>
  {:else}
    {#each chips as chip}
      {#if chip.kind === 'working'}
        <li class="chip chip-working"><span class="chip-dot" aria-hidden="true"></span>{chip.text}</li>
      {:else if chip.kind === 'waiting'}
        <li class="chip chip-waiting">{chip.text}</li>
      {:else}
        <li class="chip">{chip.text}</li>
      {/if}
    {/each}
  {/if}
</ul>
