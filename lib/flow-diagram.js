'use strict';

const { VIEWS, flowActors, flowCounts, flowWarnings, transitionTable } = require('./flow.js');

const TILE_W = 200;
const TILE_H = 56;
const TILE_GAP = 56;
const GUTTER = 280;
const LINE = 20;
const PAD = 24;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const label = (step) => `${step.event}${step.guard ? ` [${step.guard}]` : ''}`;
const clip = (value, max) => {
  const textValue = String(value ?? '');
  return textValue.length > max ? `${textValue.slice(0, max - 1)}…` : textValue;
};
const hotspotText = (step) => (step.hotspot === true ? 'undecided' : step.hotspot);
const sideCount = (step) => (step.effects || []).filter((effect) => !effect.ac).length;

const STYLE = `
:root{--bg:#f5f7fa;--grid:#e9edf3;--paper:#fff;--ink:#141821;--muted:#4f5867;--line:#cfd6e1;--edge:#475467;--accent:#4338ca;--side:#92400e;--sidebg:#fff3dc;--hot:#b42318;--hotbg:#fee4e2;--ok:#05603a;--okbg:#dcfae6;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0d1016;--grid:#171c26;--paper:#161b24;--ink:#eef1f6;--muted:#a8b1c0;--line:#2e3646;--edge:#aab4c4;--accent:#a5b4fc;--side:#fcd27b;--sidebg:#3b2908;--hot:#fda29b;--hotbg:#47150f;--ok:#75e0a7;--okbg:#0b3324}}
*{box-sizing:border-box}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{margin:0;background-color:var(--bg);background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:24px 24px;color:var(--ink);font:400 1rem/1.55 var(--sans)}
.wrap{max-width:72rem;margin:0 auto;padding:2.25rem 1rem 4.5rem}
header{display:flex;justify-content:space-between;gap:1.5rem;align-items:flex-end;flex-wrap:wrap;margin-bottom:1.25rem}
h1{font-size:1.75rem;line-height:1.2;letter-spacing:-0.015em;margin:.25rem 0 0;font-weight:650;max-width:40ch;text-wrap:balance}
h2{font-size:1.125rem;line-height:1.3;margin:0 0 .25rem;font-weight:650}
.sub{margin:0 0 1rem;color:var(--muted);font-size:.9375rem;max-width:70ch}
.kicker{margin:0;color:var(--muted);font-family:var(--mono);font-size:.8125rem}
.counts{display:flex;gap:.625rem;flex-wrap:wrap}
.count{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:.5rem .875rem;min-width:7rem}
.count b{display:block;font-size:1.5rem;line-height:1.2;font-variant-numeric:tabular-nums}.count span{font-size:.8125rem;color:var(--muted)}
.count.alert b{color:var(--side)}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:1.5rem;margin-bottom:1.125rem}
.scroll{overflow-x:auto;margin:0 -0.25rem;padding:0 .25rem}
.hint{display:none;font-size:.8125rem;color:var(--muted);margin:0 0 .5rem}
@media (max-width:48rem){.hint{display:block}}
.scroll:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:8px}
.legend{display:flex;gap:.5rem 1.25rem;flex-wrap:wrap;font-size:.875rem;color:var(--muted);margin-top:1rem;padding-top:.875rem;border-top:1px solid var(--line)}
.legend span{white-space:nowrap}
.swatch{display:inline-block;width:1.75rem;height:0;margin-right:.5rem;vertical-align:middle;border-top:2px solid var(--edge)}
.swatch.hot{border-top:2px dashed var(--hot)}
svg{display:block;max-width:none}
svg text{font-family:var(--mono);font-size:13px;fill:var(--ink)}
svg .title{font-family:var(--sans);font-size:15px;font-weight:600}
svg .meta{fill:var(--muted)}
svg .tile{fill:var(--paper);stroke:var(--line);stroke-width:1.5}
svg .tile.initial{stroke:var(--accent);stroke-width:2.5}
svg .tile.end{stroke-dasharray:2 0;fill:var(--bg)}
svg .tile.warn{stroke:var(--side);stroke-dasharray:6 4}
svg .edge{fill:none;stroke:var(--edge);stroke-width:1.5}
svg .edge.hotspot{stroke:var(--hot);stroke-dasharray:7 5}
svg .lbl{paint-order:stroke;stroke:var(--paper);stroke-width:6px;stroke-linejoin:round}
svg .effect{fill:var(--ok)}
svg .effect.side{fill:var(--side);font-weight:600}
svg .hotspot-text{fill:var(--hot);font-weight:600}
svg .lane{fill:var(--bg);stroke:var(--line)}
svg .lane-name{font-family:var(--sans);font-size:14px;font-weight:600;fill:var(--muted)}
table.transitions{border-collapse:separate;border-spacing:0;width:100%;font-size:.9375rem}
table.transitions th,table.transitions td{border-bottom:1px solid var(--line);padding:.625rem .75rem;text-align:start;vertical-align:top}
table.transitions thead th{color:var(--muted);font-weight:600;font-family:var(--mono);font-size:.8125rem;white-space:nowrap}
table.transitions tbody th{font-weight:600;white-space:nowrap}
td.cell.undecided{background:var(--sidebg);color:var(--side);font-weight:650}
td.cell.invalid{color:var(--muted)}
td.cell.conflict{background:var(--hotbg);color:var(--hot);font-weight:600}
.ends{color:var(--muted);font-size:.9375rem;margin:.75rem 0 0}
.board{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:1rem;counter-reset:frame}
.frame{background:var(--paper);border:1.5px solid var(--line);border-radius:31.5px;padding:1rem;display:flex;flex-direction:column;gap:.625rem;counter-increment:frame}
.frame.initial{border-color:var(--accent);border-width:2.5px}
.screen{border:1px solid var(--line);border-radius:14px;padding:.875rem;min-height:5.5rem;background:var(--bg)}
.screen small{display:block;font-family:var(--mono);font-size:.75rem;color:var(--muted)}
.screen small::before{content:"Step " counter(frame)}
.screen b{font-size:1.0625rem;line-height:1.3;overflow-wrap:break-word}
.step{font-family:var(--mono);font-size:.875rem;line-height:1.5;border-top:1px dashed var(--line);padding-top:.5rem;overflow-wrap:break-word}
.step.hotspot{color:var(--hot)}
.chips{display:flex;flex-wrap:wrap;gap:.375rem;margin-top:.375rem}
.pill{display:inline-block;font-size:.8125rem;line-height:1.4;padding:.1875rem .625rem;border-radius:999px;background:var(--okbg);color:var(--ok);font-family:var(--mono);overflow-wrap:anywhere}
.pill.side{background:var(--sidebg);color:var(--side);border:1px dashed var(--side)}
.pill.side::before{content:"not in AC · "}
.pill.hotspot{background:var(--hotbg);color:var(--hot)}
.pill.hotspot::before{content:"decide · "}
ol.steps{margin:1.25rem 0 0;padding:0;list-style:none;display:grid;gap:.5rem}
ol.steps li{border-top:1px dashed var(--line);padding-top:.5rem;font-size:.9375rem;max-width:80ch}
ol.steps b{font-family:var(--mono);font-size:.8125rem;color:var(--muted);margin-right:.5rem}
ul.notes{margin:0;padding-left:1.125rem;color:var(--muted);max-width:70ch}
@media (max-width:40rem){h1{font-size:1.375rem}.panel{padding:1rem}}
`;

function legendHtml(view) {
  const items = [
    '<span><i class="swatch"></i>transition</span>',
    '<span><i class="swatch hot"></i>hotspot: decide before freeze</span>',
    '<span><span class="pill">effect · AC-n</span> covered by an AC</span>',
    '<span><span class="pill side">effect</span> side effect</span>'
  ];
  if (view === 'state') items.push('<span><b>?</b> = nobody decided this transition</span>');
  return `<div class="legend">${items.join('')}</div>`;
}

function scrollBox(inner, title, what = 'diagram') {
  return `<p class="hint">Scroll sideways to see the whole ${what} →</p><div class="scroll" tabindex="0" role="region" aria-label="${escapeHtml(title)}">${inner}</div>`;
}

function svg(width, height, body, title) {
  return scrollBox(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>${body}</svg>`, title);
}

function edgeLabel(step, x, y, anchor = 'start') {
  const total = (step.effects || []).length;
  const side = sideCount(step);
  const effects = total ? `<tspan class="effect${side ? ' side' : ''}"> · ${total} effect${total > 1 ? 's' : ''}${side ? `, ${side} not in AC` : ''}</tspan>` : '';
  const hot = step.hotspot ? `<tspan class="hotspot-text hotspot"> · decide</tspan>` : '';
  return `<text class="lbl" x="${x}" y="${y}" text-anchor="${anchor}"><title>${escapeHtml(label(step))}</title>${escapeHtml(clip(label(step), 28))}${effects}${hot}</text>`;
}

function layering(flow) {
  const states = [...new Set(flow.flatMap((step) => [step.from, step.to]))];
  const outgoing = new Map(states.map((state) => [state, flow.filter((step) => step.from === state && step.to !== state)]));
  const back = new Set();
  const visiting = new Set();
  const done = new Set();
  const visit = (state) => {
    visiting.add(state);
    for (const step of outgoing.get(state)) {
      if (visiting.has(step.to)) back.add(step);
      else if (!done.has(step.to)) visit(step.to);
    }
    visiting.delete(state);
    done.add(state);
  };
  for (const state of states) if (!done.has(state)) visit(state);
  const rank = new Map(states.map((state) => [state, 0]));
  for (let pass = 0; pass < states.length; pass += 1) {
    for (const step of flow) {
      if (step.from === step.to || back.has(step)) continue;
      if (rank.get(step.to) < rank.get(step.from) + 1) rank.set(step.to, rank.get(step.from) + 1);
    }
  }
  return { states, rank, back };
}

function stateSvg(goal) {
  const flow = goal.flow;
  const warned = flowWarnings(flow).join(' ');
  const { states, rank, back } = layering(flow);
  const sources = new Set(flow.map((step) => step.from));
  const forward = flow.filter((step) => step.from !== step.to && !back.has(step));
  const adjacent = forward.filter((step) => rank.get(step.to) - rank.get(step.from) === 1);
  const long = forward.filter((step) => rank.get(step.to) - rank.get(step.from) > 1);
  const rows = new Map();
  for (const state of states) {
    const r = rank.get(state);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push(state);
  }
  const rowCount = Math.max(...rows.keys()) + 1;
  const widest = Math.max(...[...rows.values()].map((list) => list.length));
  const left = PAD + (back.size ? GUTTER : 0);
  const gapAfter = new Map();
  for (let r = 0; r < rowCount; r += 1) {
    const leaving = adjacent.filter((step) => rank.get(step.from) === r).length;
    const arriving = long.filter((step) => rank.get(step.to) === r + 1).length;
    gapAfter.set(r, 36 + (leaving + arriving) * LINE);
  }
  const rowY = new Map();
  let y = PAD + 20;
  for (let r = 0; r < rowCount; r += 1) {
    rowY.set(r, y);
    y += TILE_H + gapAfter.get(r);
  }
  const bodyRight = left + widest * TILE_W + (widest - 1) * TILE_GAP;
  const width = bodyRight + (long.length || flow.some((step) => step.from === step.to) ? GUTTER : 0) + PAD;
  const height = y - gapAfter.get(rowCount - 1) + PAD + 20;
  const pos = new Map();
  for (const [r, list] of rows) {
    const offset = ((widest - list.length) * (TILE_W + TILE_GAP)) / 2;
    list.forEach((state, i) => pos.set(state, { x: left + offset + i * (TILE_W + TILE_GAP), y: rowY.get(r) }));
  }
  const outs = new Map(states.map((state) => [state, adjacent.filter((step) => step.from === state)]));
  const ins = new Map(states.map((state) => [state, forward.filter((step) => step.to === state)]));
  const portX = (list, step, p) => p.x + ((list.indexOf(step) + 1) * TILE_W) / (list.length + 1);
  const edges = [];
  const labels = [];
  const rowSlot = new Map();
  for (const step of adjacent) {
    const a = pos.get(step.from);
    const b = pos.get(step.to);
    const r = rank.get(step.from);
    const slot = rowSlot.get(r) || 0;
    rowSlot.set(r, slot + 1);
    const x1 = portX(outs.get(step.from), step, a);
    const x2 = portX(ins.get(step.to), step, b);
    const mid = a.y + TILE_H + 26 + slot * LINE;
    edges.push(`<path class="edge${step.hotspot ? ' hotspot' : ''}" d="M${x1} ${a.y + TILE_H} V${mid} H${x2} V${b.y - 4}" marker-end="url(#arrow)"/>`);
    labels.push(edgeLabel(step, Math.min(x1, x2) + 10, mid - 5));
  }
  long.forEach((step, i) => {
    const a = pos.get(step.from);
    const b = pos.get(step.to);
    const gx = bodyRight + 24 + i * 14;
    const r = rank.get(step.to) - 1;
    const slot = rowSlot.get(r) || 0;
    rowSlot.set(r, slot + 1);
    const lane = rowY.get(r) + TILE_H + 26 + slot * LINE;
    const x2 = portX(ins.get(step.to), step, b);
    edges.push(`<path class="edge${step.hotspot ? ' hotspot' : ''}" d="M${a.x + TILE_W} ${a.y + TILE_H / 2} H${gx} V${lane} H${x2} V${b.y - 4}" marker-end="url(#arrow)"/>`);
    labels.push(edgeLabel(step, x2 + 10, lane - 5));
  });
  [...back].forEach((step, i) => {
    const a = pos.get(step.from);
    const b = pos.get(step.to);
    const gx = left - 24 - i * 14;
    edges.push(`<path class="edge${step.hotspot ? ' hotspot' : ''}" d="M${a.x} ${a.y + TILE_H / 2} H${gx} V${b.y + TILE_H / 2} H${b.x - 4}" marker-end="url(#arrow)"/>`);
    labels.push(edgeLabel(step, gx - 10, a.y + TILE_H / 2 - 6, 'end'));
  });
  for (const step of flow.filter((item) => item.from === item.to)) {
    const a = pos.get(step.from);
    const yy = a.y + TILE_H / 2;
    edges.push(`<path class="edge${step.hotspot ? ' hotspot' : ''}" d="M${a.x + TILE_W} ${yy - 10} H${a.x + TILE_W + 22} V${yy + 10} H${a.x + TILE_W + 4}" marker-end="url(#arrow)"/>`);
    labels.push(edgeLabel(step, a.x + TILE_W + 30, yy + 4));
  }
  const tiles = states.map((state) => {
    const p = pos.get(state);
    const cls = ['tile', state === flow[0].from ? 'initial' : '', sources.has(state) ? '' : 'end', warned.includes(`"${state}"`) ? 'warn' : ''].filter(Boolean).join(' ');
    const tag = state === flow[0].from ? 'start' : sources.has(state) ? '' : 'end state';
    return `<g><title>${escapeHtml(state)}</title><rect class="${cls}" x="${p.x}" y="${p.y}" width="${TILE_W}" height="${TILE_H}" rx="12"/><text class="title" x="${p.x + TILE_W / 2}" y="${p.y + (tag ? 25 : 33)}" text-anchor="middle">${escapeHtml(clip(state, 22))}</text>${tag ? `<text class="meta" x="${p.x + TILE_W / 2}" y="${p.y + 44}" text-anchor="middle">${tag}</text>` : ''}</g>`;
  }).join('');
  return svg(width, height, `${edges.join('')}${tiles}${labels.join('')}`, `State machine of ${goal.flowSubject || 'the Goal flow'}`);
}

function tableHtml(goal) {
  const table = transitionTable(goal);
  const head = `<thead><tr><th scope="col">state \\ event</th>${table.events.map((event) => `<th scope="col">${escapeHtml(event)}</th>`).join('')}</tr></thead>`;
  const rows = table.rows.map((row) => `<tr><th scope="row">${escapeHtml(row.state)}</th>${table.events.map((event) => {
    const c = row.cells[event];
    if (c.kind === 'undecided') return '<td class="cell undecided">?</td>';
    if (c.kind === 'invalid') return '<td class="cell invalid">invalid</td>';
    const body = c.targets.map((t) => {
      const step = goal.flow.find((item) => item.from === row.state && item.event === event && item.to === t.to);
      const chips = [
        ...(step?.effects || []).map((effect) => `<span class="pill${effect.ac ? '' : ' side'}">${escapeHtml(effect.text)}${effect.ac ? ` · ${escapeHtml(effect.ac)}` : ''}</span>`),
        step?.hotspot ? `<span class="pill hotspot">${escapeHtml(hotspotText(step))}</span>` : ''
      ].filter(Boolean).join('');
      return `→ ${escapeHtml(t.to)}${t.guard ? ` [${escapeHtml(t.guard)}]` : ''}${chips ? `<div class="chips">${chips}</div>` : ''}`;
    }).join('<br>');
    return `<td class="cell ${c.kind}">${c.kind === 'conflict' ? 'conflict: ' : ''}${body}</td>`;
  }).join('')}</tr>`).join('');
  const ends = table.endStates.length ? `<p class="ends">End states: ${table.endStates.map(escapeHtml).join(', ')}</p>` : '';
  return `<section class="panel"><h2>Transition table</h2><p class="sub">Every state × event. Each <b>?</b> is a decision the Goal has not made: add an AC, a non-goal, or list it in <code>forbiddenTransitions</code>.</p>${scrollBox(`<table class="transitions">${head}<tbody>${rows}</tbody></table>`, 'Transition table', 'table')}${ends}</section>`;
}

function storyboardHtml(goal) {
  const flow = goal.flow;
  const states = [...new Set(flow.flatMap((step) => [step.from, step.to]))];
  const frames = states.map((state) => {
    const steps = flow.filter((step) => step.from === state).map((step) => {
      const chips = [
        ...(step.effects || []).map((effect) => `<span class="pill${effect.ac ? '' : ' side'}">${escapeHtml(effect.text)}${effect.ac ? ` · ${escapeHtml(effect.ac)}` : ''}</span>`),
        step.hotspot ? `<span class="pill hotspot">${escapeHtml(hotspotText(step))}</span>` : ''
      ].filter(Boolean).join('');
      return `<div class="step${step.hotspot ? ' hotspot' : ''}">${escapeHtml(`${label(step)} → ${step.to}`)}${chips ? `<div class="chips">${chips}</div>` : ''}</div>`;
    }).join('');
    return `<li class="frame${state === flow[0].from ? ' initial' : ''}"><div class="screen"><small></small><b>${escapeHtml(state)}</b></div>${steps || '<div class="step">End of flow</div>'}</li>`;
  });
  return `<section class="panel"><h2>Storyboard</h2><p class="sub">One card per screen or state, in the order the flow first reaches it. Effects sit under the action that causes them.</p><ol class="board" style="list-style:none;padding:0;margin:0">${frames.join('')}</ol>${legendHtml('storyboard')}</section>`;
}

function lanesSvg(goal) {
  const flow = goal.flow;
  const actors = flowActors(flow);
  const colW = TILE_W + 72;
  const head = 44;
  const effectLines = (step) => (step.effects || []).length + (step.hotspot ? 1 : 0);
  const rowY = [];
  let y = PAD + head;
  for (const step of flow) {
    rowY.push(y);
    y += TILE_H + 34 + effectLines(step) * LINE;
  }
  const width = PAD * 2 + actors.length * colW;
  const height = y + PAD - 20;
  const actorOf = (step) => (step.actor ? String(step.actor).trim() : 'user');
  const colX = (actor) => PAD + actors.indexOf(actor) * colW + (colW - TILE_W) / 2;
  const lanes = actors.map((actor, i) => `<rect class="lane" x="${PAD + i * colW + 6}" y="${PAD}" width="${colW - 12}" height="${height - PAD * 2}" rx="12"/><text class="lane-name" x="${PAD + i * colW + colW / 2}" y="${PAD + 26}" text-anchor="middle">${escapeHtml(clip(actor, 20))}</text>`).join('');
  const parts = [];
  flow.forEach((step, i) => {
    const x = colX(actorOf(step));
    const ty = rowY[i];
    const effects = (step.effects || []).map((effect, k) => `<text class="effect${effect.ac ? '' : ' side'} lbl" x="${x + 4}" y="${ty + TILE_H + 20 + k * LINE}">${escapeHtml(`${effect.ac ? '' : 'not in AC: '}${clip(effect.text, 24)}${effect.ac ? ` · ${effect.ac}` : ''}`)}</text>`).join('');
    const hot = step.hotspot ? `<text class="hotspot-text hotspot lbl" x="${x + 4}" y="${ty + TILE_H + 20 + (step.effects || []).length * LINE}">${escapeHtml(`decide: ${clip(hotspotText(step), 22)}`)}</text>` : '';
    parts.push(`<g><title>${escapeHtml(`${label(step)}: ${step.from} → ${step.to}`)}</title><rect class="tile${step.hotspot ? ' warn' : ''}" x="${x}" y="${ty}" width="${TILE_W}" height="${TILE_H}" rx="10"/><text class="title" x="${x + 12}" y="${ty + 23}">${escapeHtml(clip(label(step), 22))}</text><text class="meta" x="${x + 12}" y="${ty + 43}">${escapeHtml(clip(`${step.from} → ${step.to}`, 24))}</text>${effects}${hot}</g>`);
    if (i > 0) {
      const prev = flow[i - 1];
      const px = colX(actorOf(prev)) + TILE_W / 2;
      const nx = x + TILE_W / 2;
      const from = rowY[i - 1] + TILE_H;
      const mid = ty - 14;
      parts.unshift(`<path class="edge${step.hotspot ? ' hotspot' : ''}" d="M${px} ${from} V${mid} H${nx} V${ty - 4}" marker-end="url(#arrow)"/>`);
    }
  });
  return svg(width, height, `${lanes}${parts.join('')}`, 'Actor lanes');
}

function stepsList(goal) {
  const items = goal.flow.map((step, i) => {
    const effects = (step.effects || []).map((effect) => `<span class="pill${effect.ac ? '' : ' side'}">${escapeHtml(effect.text)}${effect.ac ? ` · ${escapeHtml(effect.ac)}` : ''}</span>`);
    if (step.hotspot) effects.push(`<span class="pill hotspot">${escapeHtml(hotspotText(step))}</span>`);
    return `<li><b>${i + 1}. ${escapeHtml(step.actor ? String(step.actor).trim() : 'user')}</b>${escapeHtml(`${label(step)}: ${step.from} → ${step.to}`)}${effects.length ? `<div class="chips">${effects.join('')}</div>` : ''}</li>`;
  }).join('');
  return `<h3 class="sub" style="margin:1.25rem 0 0">Steps in order</h3><ol class="steps">${items}</ol>`;
}

function renderDiagram(goal, { view, revision, now = new Date(), lang = null } = {}) {
  const contentLang = lang ? ` lang="${escapeHtml(lang)}"` : '';
  if (!VIEWS.includes(view)) throw new Error(`Unknown view "${view}": use state, storyboard or lanes`);
  if (!Array.isArray(goal?.flow) || !goal.flow.length) throw new Error('The Goal has no flow to draw; add flow steps ({from, event, to}) to the draft first');
  const counts = flowCounts(goal);
  const titles = { state: 'State machine', storyboard: 'Storyboard', lanes: 'Actor lanes' };
  let body;
  if (view === 'state') {
    body = `<section class="panel"><h2>${escapeHtml(goal.flowSubject ? `Status of ${goal.flowSubject}` : 'States')}</h2><p class="sub">Read top to bottom. Labels read <code>event [guard]</code>; dashed red lines are transitions still to decide.</p>${stateSvg(goal)}${legendHtml('state')}</section>${tableHtml(goal)}`;
  } else if (view === 'storyboard') {
    body = storyboardHtml(goal);
  } else {
    body = `<section class="panel"><h2>Actor lanes</h2><p class="sub">One column per actor, steps in flow order from top to bottom. Work that runs later (jobs, cron) shows up in its own column.</p>${lanesSvg(goal)}${stepsList(goal)}${legendHtml('lanes')}</section>`;
  }
  const warnings = flowWarnings(goal.flow);
  const notes = warnings.length ? `<section class="panel"><h2>Flow warnings</h2><ul class="notes">${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></section>` : '';
  const count = (n, text) => `<div class="count${n ? ' alert' : ''}"><b>${n}</b><span>${escapeHtml(text)}</span></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(`${titles[view]} · ${clip(goal.objective || 'Goal', 60)}`)}</title><style>${STYLE}</style></head><body><main class="wrap"><header><div><p class="kicker">${escapeHtml(`AEL Goal · ${titles[view]} · revision ${revision ?? 'frozen'} · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`)}</p><h1${contentLang}>${escapeHtml(goal.objective || '')}</h1></div><div class="counts">${count(counts.undecided, 'undecided')}${count(counts.hotspots, 'hotspots')}${count(counts.sideEffects, 'side effects')}</div></header><div${contentLang}>${body}</div>${notes}</main></body></html>`;
}

module.exports = { escapeHtml, renderDiagram };
