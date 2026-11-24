export function swapMode(direction, { reducedMotion = false, mounted = true } = {}) {
  if (!mounted) return 'mount';
  if (!direction || reducedMotion) return 'reuse';
  return 'slide';
}

export function createCarriers(stage, { build, dispose }) {
  let current = null;
  let outgoing = null;

  function finish() {
    if (outgoing) dispose(outgoing);
    outgoing = null;
  }

  return {
    get current() {
      return current;
    },
    get outgoing() {
      return outgoing;
    },
    mount(model) {
      finish();
      if (current) dispose(current);
      current = build(model);
      stage.add(current.carrier);
      return current;
    },
    slide(model) {
      finish();
      const incoming = build(model);
      stage.add(incoming.carrier);
      outgoing = current;
      current = incoming;
      return incoming;
    },
    finish,
    dispose() {
      finish();
      if (current) dispose(current);
      current = null;
    }
  };
}
