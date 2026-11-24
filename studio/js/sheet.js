export const SHEET_DISMISS_FRACTION = 0.25;
export const SHEET_DISMISS_VELOCITY = 0.5;

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
