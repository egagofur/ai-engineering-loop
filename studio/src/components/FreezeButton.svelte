<script>
  let { actor = null, action = null, source, freeze, nameAction, onfreeze, onname, className = 'primary', label = null, ariaLabel = undefined, extra = {} } = $props();

  const mine = $derived(freeze && freeze.source === source);
  const text = $derived(mine && freeze.phase === 'busy' ? 'Freezing…' : mine && freeze.phase === 'done' ? 'Frozen' : label || (actor ? `Freeze as ${actor}` : 'Freeze…'));

  function click() {
    if (actor) onfreeze(source);
    else onname(source);
  }
</script>

<button type="button" class={className} data-action={action || (actor ? 'freeze' : nameAction)} {...extra} aria-label={ariaLabel} disabled={mine && freeze.phase === 'busy'} data-done={mine && freeze.phase === 'done' ? 'true' : undefined} onclick={click}>{text}</button>
