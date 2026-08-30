'use strict';

function parseClaimedVsReality(markdown) {
  const rows = [];
  if (!markdown || !String(markdown).trim()) return { rows };
  const lines = String(markdown).split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|\s*-+\s*\|/.test(trimmed) || /^\|\s*AC\s*\|/i.test(trimmed)) continue;
    const cells = trimmed.split('|').map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 3) continue;
    rows.push({
      ac: cells[0],
      claimed: cells[1],
      reality: cells[2]
    });
  }
  return { rows };
}

function readyForDa(markdown) {
  const { rows } = parseClaimedVsReality(markdown);
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const reality = (row.reality || '').trim();
    if (!reality) return false;
    if (/^seems green$/i.test(reality)) return false;
    if (!(row.claimed || '').trim()) return false;
    return true;
  });
}

module.exports = {
  parseClaimedVsReality,
  readyForDa
};
