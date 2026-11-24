const TAB_KEYS = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (index, count) => count - 1
};

export function tabKeys(event, names, current) {
  const move = TAB_KEYS[event.key];
  if (!move) return null;
  event.preventDefault();
  return names[move(names.indexOf(current), names.length)];
}
