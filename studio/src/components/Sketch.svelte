<script>
  import FreezeButton from './FreezeButton.svelte';
  import { REVISE_HINT, SKETCH_VIEWS, recommendedView, sketchCounts, sketchFrameTitle, sketchOptions } from '../../js/detail.js';
  import { tabKeys } from '../tabs.js';

  let { detail = null, sketchKey = null, view = null, frames = [], urlFor, actor = null, freeze = null, onview, onfreeze, onfreezename } = $props();

  const options = $derived(sketchOptions(detail));
  const selected = $derived(options.some((option) => option.view === view) ? view : recommendedView(detail));
  let loaded = $state({});
  const tabs = {};

  $effect(() => {
    void sketchKey;
    loaded = {};
  });

  function keydown(event, current) {
    const next = tabKeys(event, options.map((option) => option.view), current);
    if (!next) return;
    onview(next);
    tabs[next].focus();
  }
</script>

<div id="sketch" class="sketch">
  {#if !options.length}
    <p class="quiet-text">There is no order sketch for this Goal.</p>
  {:else}
    <p class="sketch-counts">{sketchCounts(detail.flowCounts)}</p>
    <div class="tabs" role="tablist" aria-label="Sketch view">
      {#each options as option (option.view)}
        <button type="button" role="tab" id="sketch-tab-{option.view}" aria-controls="sketch-panel" aria-selected={option.view === selected ? 'true' : 'false'} tabindex={option.view === selected ? 0 : -1} data-sketch-view={option.view} title={option.reason || ''} bind:this={tabs[option.view]} onclick={() => onview(option.view)} onkeydown={(event) => keydown(event, option.view)}>{SKETCH_VIEWS[option.view]}{#if option.recommended}{' '}<span class="tab-note">Recommended</span>{/if}</button>
      {/each}
    </div>
    <div id="sketch-panel" class="sketch-panel" role="tabpanel" aria-labelledby="sketch-tab-{selected}" aria-busy={loaded[selected] ? undefined : 'true'} data-loaded={loaded[selected] ? 'true' : 'false'}>
      <div class="sketch-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
      {#each frames as frame (frame)}
        <iframe class="sketch-frame" title={sketchFrameTitle(frame)} sandbox="" referrerpolicy="no-referrer" data-view={frame} data-loaded={loaded[frame] ? 'true' : undefined} src={urlFor(frame)} hidden={frame !== selected} onload={() => (loaded = { ...loaded, [frame]: true })}></iframe>
      {/each}
    </div>
    <div class="sketch-foot">
      <p class="quiet-text">{REVISE_HINT}</p>
      <FreezeButton {actor} source="sketch" {freeze} nameAction="sketch-freeze-name" {onfreeze} onname={onfreezename} />
    </div>
  {/if}
</div>
