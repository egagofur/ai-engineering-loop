export const SHEET_DISMISS_FRACTION = 0.25;
export const SHEET_DISMISS_VELOCITY = 0.5;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function shouldDismiss(distance, velocity, height) {
  if (distance <= 0) return false;
  return velocity > SHEET_DISMISS_VELOCITY || distance > height * SHEET_DISMISS_FRACTION;
}

export function dragOffset(distance) {
  return distance >= 0 ? distance : -Math.sqrt(-distance) * 2;
}

export function trapFocus(event, container) {
  if (event.key !== 'Tab') return false;
  const items = [...container.querySelectorAll(FOCUSABLE)].filter((item) => !item.closest('[hidden]'));
  if (!items.length) return false;
  const first = items[0];
  const last = items[items.length - 1];
  const active = container.ownerDocument.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    last.focus();
    event.preventDefault();
    return true;
  }
  if (!event.shiftKey && active === last) {
    first.focus();
    event.preventDefault();
    return true;
  }
  return false;
}

export function createSheet(root, { onOpenChange = () => {} } = {}) {
  const panel = root.querySelector('.sheet-panel');
  const handle = root.querySelector('.sheet-grab');
  let opener = null;
  let drag = null;

  function finishClose() {
    if (root.dataset.open === 'true') return;
    root.hidden = true;
    panel.style.removeProperty('transform');
  }

  function open(from) {
    if (root.dataset.open === 'true') return;
    opener = from || null;
    root.hidden = false;
    void panel.offsetHeight;
    root.dataset.open = 'true';
    onOpenChange(true);
    panel.focus();
  }

  function close() {
    if (root.dataset.open !== 'true') return;
    root.dataset.open = 'false';
    panel.style.removeProperty('transform');
    onOpenChange(false);
    const fallback = window.setTimeout(finishClose, 600);
    panel.addEventListener('transitionend', () => {
      window.clearTimeout(fallback);
      finishClose();
    }, { once: true });
    if (opener && opener.isConnected) opener.focus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(event, panel);
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse') return;
    drag = { startY: event.clientY, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    root.dataset.dragging = 'true';
    handle.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag) return;
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    panel.style.transform = `translateY(${dragOffset(event.clientY - drag.startY).toFixed(1)}px)`;
  }

  function onPointerUp() {
    if (!drag) return;
    const distance = drag.lastY - drag.startY;
    const dismiss = shouldDismiss(distance, drag.velocity, panel.offsetHeight);
    drag = null;
    delete root.dataset.dragging;
    if (dismiss) close();
    else panel.style.removeProperty('transform');
  }

  root.addEventListener('keydown', onKeydown);
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="close-details"]')) close();
  });
  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerUp);

  return { open, close, isOpen: () => root.dataset.open === 'true' };
}
