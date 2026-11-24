<script>
  import { untrack } from 'svelte';
  import { dragOffset, shouldDismiss, trapFocus } from '../../js/sheet.js';

  let { id, className = 'sheet', titleId, title, closeLabel, open = false, opener = null, onclose, children } = $props();


  let panel;
  let shown = $state(false);
  let openAttr = $state(undefined);
  let dragging = $state(false);
  let drag = null;
  let fallback = 0;

  $effect(() => {
    const wanted = open;
    untrack(() => (wanted ? show() : hide()));
  });

  function show() {
    window.clearTimeout(fallback);
    shown = true;
    requestAnimationFrame(() => {
      if (!open) return;
      void panel.offsetHeight;
      openAttr = 'true';
      panel.focus();
    });
  }

  function hide() {
    if (openAttr !== 'true') {
      shown = false;
      return;
    }
    openAttr = 'false';
    panel.style.removeProperty('transform');
    const finish = () => {
      window.clearTimeout(fallback);
      if (!open) shown = false;
    };
    fallback = window.setTimeout(finish, 600);
    panel.addEventListener('transitionend', finish, { once: true });
    if (opener && opener.isConnected) opener.focus();
  }

  function keydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
      return;
    }
    trapFocus(event, panel);
  }

  function pointerdown(event) {
    if (event.pointerType === 'mouse') return;
    drag = { startY: event.clientY, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    dragging = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointermove(event) {
    if (!drag) return;
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    panel.style.transform = `translateY(${dragOffset(event.clientY - drag.startY).toFixed(1)}px)`;
  }

  function pointerup() {
    if (!drag) return;
    const dismiss = shouldDismiss(drag.lastY - drag.startY, drag.velocity, panel.offsetHeight);
    drag = null;
    dragging = false;
    if (dismiss) onclose();
    else panel.style.removeProperty('transform');
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_interactive_supports_focus -->
<div {id} class={className} role="dialog" aria-modal="true" aria-labelledby={titleId} hidden={!shown} data-open={openAttr} data-dragging={dragging ? 'true' : undefined} onkeydown={keydown}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="sheet-backdrop" data-action="close-details" onclick={onclose}></div>
  <div class="sheet-panel" tabindex="-1" bind:this={panel}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="sheet-grab" onpointerdown={pointerdown} onpointermove={pointermove} onpointerup={pointerup} onpointercancel={pointerup}>
      <span class="sheet-handle" aria-hidden="true"></span>
      <h2 id={titleId} class="sheet-title">{title}</h2>
      <button type="button" class="sheet-close" data-action="close-details" aria-label={closeLabel} onclick={onclose}>Close</button>
    </div>
    {@render children()}
  </div>
</div>
