'use strict';

const { escapeHtml: esc } = require('./flow-diagram.js');
const { STAGES, cycle } = require('./recap.js');

const AUDIENCES = ['me', 'lead', 'client'];
const DAY = 86400000;

const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function fmtDur(ms) {
  if (!ms) return '0m';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const fileUrl = (p) => `file://${encodeURI(p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:'))}`;

const STYLE = `
:root{--bg:#f5f7fa;--grid:#e9edf3;--paper:#fff;--ink:#141821;--muted:#4f5867;--line:#d5dbe5;--accent:#4338ca;--accentbg:#eef0ff;--ok:#05603a;--okbg:#dcfae6;--warn:#92400e;--warnbg:#fff3dc;--bad:#b42318;--badbg:#fee4e2;--info:#1849a9;--infobg:#d1e9ff;--goal:#98a2b3;--maker:#7a5af8;--verify:#12b76a;--review:#f79009;--deliver:#2e90fa;--heat:#4338ca;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0d1016;--grid:#171c26;--paper:#161b24;--ink:#eef1f6;--muted:#a8b1c0;--line:#2e3646;--accent:#a5b4fc;--accentbg:#252a4d;--ok:#75e0a7;--okbg:#0b3324;--warn:#fcd27b;--warnbg:#3b2908;--bad:#fda29b;--badbg:#47150f;--info:#84caff;--infobg:#102a56}}
*{box-sizing:border-box}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{margin:0;background-color:var(--bg);background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:24px 24px;color:var(--ink);font:400 1rem/1.55 var(--sans)}
.wrap{max-width:74rem;margin:0 auto;padding:2.5rem 1rem 5rem}
header.top{display:flex;justify-content:space-between;align-items:flex-end;gap:1.5rem;flex-wrap:wrap;margin-bottom:1.5rem}
.kicker{margin:0;color:var(--muted);font-family:var(--mono);font-size:.8125rem}
h1{font-size:2rem;line-height:1.15;letter-spacing:-0.02em;margin:.25rem 0 0;font-weight:650}
h2{font-size:1.25rem;line-height:1.3;letter-spacing:-0.01em;margin:0 0 1rem;font-weight:650}
h3{font-size:1.0625rem;line-height:1.35;margin:0;font-weight:650;overflow-wrap:break-word}
h4{font-size:.875rem;color:var(--muted);margin:1.25rem 0 .5rem;font-weight:600}
p{margin:0}
.muted{color:var(--muted)}
code{font-family:var(--mono);font-size:.875rem;background:var(--bg);border:1px solid var(--line);padding:.0625rem .375rem;border-radius:6px;overflow-wrap:anywhere}
.scope{text-align:end;color:var(--muted);font-size:.9375rem}
.tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin:0 0 1.5rem}
.tabs button{font:inherit;font-weight:600;padding:.625rem 1.125rem;border-radius:10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);cursor:pointer}
.tabs button[aria-pressed=true]{background:var(--accentbg);border-color:var(--accent);color:var(--accent)}
.tabs button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.js section.view:not(.on){display:none}
section.view{margin-bottom:2.5rem}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:1.5rem;margin-bottom:1.25rem}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:1rem;margin-bottom:1.25rem}
.metric{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:1.125rem 1.25rem}
.metric p{color:var(--muted);font-size:.875rem}
.metric b{display:block;font-size:2.125rem;line-height:1.15;margin:.375rem 0 .25rem;font-weight:650;font-variant-numeric:tabular-nums}
.delta{font-size:.8125rem;font-variant-numeric:tabular-nums}.delta.good{color:var(--ok)}.delta.bad{color:var(--bad)}.delta.same{color:var(--muted)}
.scroll{overflow-x:auto}
table.heat{border-collapse:separate;border-spacing:.375rem;width:100%;min-width:34rem}
table.heat th{font-weight:600;font-size:.8125rem;color:var(--muted);text-align:center;white-space:nowrap}
table.heat th[scope=row]{text-align:start;font-family:var(--mono);color:var(--ink)}
.cell{height:2.75rem;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:650;font-variant-numeric:tabular-nums;background:color-mix(in srgb,var(--heat) var(--o),var(--bg));color:var(--ink)}
.bars{display:flex;flex-direction:column;gap:.875rem}
.barrow{display:grid;grid-template-columns:minmax(0,18rem) minmax(0,1fr) 5rem;gap:1rem;align-items:center}
.barlabel b{display:block;font-weight:600;overflow-wrap:break-word}
.barlabel span{font-size:.8125rem;color:var(--muted);font-family:var(--mono)}
.bar{display:flex;height:1.375rem;border-radius:6px;overflow:hidden;background:var(--bg);border:1px solid var(--line)}
.seg{height:100%}
.seg.goal{background:var(--goal)}.seg.maker{background:var(--maker)}.seg.verify{background:var(--verify)}.seg.review{background:var(--review)}.seg.deliver{background:var(--deliver)}
.bardetail{grid-column:2/4;font-family:var(--mono);font-size:.8125rem;color:var(--muted);margin-top:-.5rem}
.bartotal{font-family:var(--mono);text-align:end;font-variant-numeric:tabular-nums}
.legend{display:flex;gap:.5rem 1.25rem;flex-wrap:wrap;margin-top:1rem;padding-top:.875rem;border-top:1px solid var(--line);font-size:.875rem;color:var(--muted)}
.legend i{display:inline-block;width:.875rem;height:.875rem;border-radius:3px;margin-right:.375rem;vertical-align:-2px}
.causes{display:flex;flex-direction:column;gap:.5rem}
.cause{display:grid;grid-template-columns:12rem 1fr 2.5rem;gap:.75rem;align-items:center;font-family:var(--mono);font-size:.875rem}
.cause span:last-child{text-align:end;font-variant-numeric:tabular-nums}
.cause .track{height:.625rem;border-radius:999px;background:var(--bg);overflow:hidden}.cause .track i{display:block;height:100%;background:var(--warn)}
.pill{display:inline-block;font-size:.8125rem;font-weight:600;line-height:1.4;padding:.1875rem .625rem;border-radius:999px;margin:.125rem .375rem .125rem 0;font-family:var(--mono);white-space:nowrap}
.pill.ok{background:var(--okbg);color:var(--ok)}.pill.warn{background:var(--warnbg);color:var(--warn)}.pill.bad{background:var(--badbg);color:var(--bad)}.pill.info{background:var(--infobg);color:var(--info)}.pill.muted{background:var(--bg);color:var(--muted);border:1px solid var(--line)}
.feature{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:1.25rem 1.5rem;margin-bottom:1rem}
.feature header{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.feature header p{font-size:.9375rem;margin-top:.25rem;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;align-content:flex-start;max-width:28rem}
details{margin-top:1rem;border-top:1px solid var(--line);padding-top:.75rem}
summary{cursor:pointer;font-weight:600;color:var(--accent)}
.list{list-style:none;margin:0;padding:0}.list li{padding:.5rem 0;border-bottom:1px dashed var(--line);max-width:80ch}
.ev{margin:.375rem 0 0;padding-left:.75rem;border-left:3px solid var(--line);color:var(--muted);font-size:.9375rem}
.files a{color:var(--accent);font-family:var(--mono);font-size:.875rem;margin-right:1rem}
.timeline{list-style:none;padding:0;margin:0;position:relative}
.timeline::before{content:"";position:absolute;left:6.5rem;top:.5rem;bottom:.5rem;width:2px;background:var(--line)}
.timeline li{display:grid;grid-template-columns:5.75rem 1fr;gap:2.5rem;margin-bottom:2rem;position:relative}
.timeline li::before{content:"";position:absolute;left:6.125rem;top:.4rem;width:.875rem;height:.875rem;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--paper)}
.timeline time{text-align:end;color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums}
.timeline h3{font-size:1.25rem;margin:.375rem 0}
.timeline p{font-size:1.0625rem;max-width:62ch;text-wrap:pretty}
.timeline .proof{color:var(--ok);font-size:.9375rem;margin-top:.5rem}
.timeline .note{color:var(--warn);font-size:.875rem;margin-top:.375rem}
.now{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:1rem}
.now div{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:1rem}
.hint{display:none;font-size:.8125rem;color:var(--muted);margin:0 0 .5rem}
@media (max-width:48rem){.hint{display:block}}
.empty{color:var(--muted);font-size:1.0625rem;padding:2rem 0;text-align:center}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
footer{color:var(--muted);font-size:.8125rem;margin-top:2rem}
@media (max-width:48rem){h1{font-size:1.5rem}.scope{text-align:start}.barrow{grid-template-columns:1fr 4rem}.barlabel{grid-column:1/3}.bardetail{grid-column:1/3;margin-top:0}.timeline::before,.timeline li::before{display:none}.timeline li{grid-template-columns:1fr;gap:.25rem}.timeline time{text-align:start}.cause{grid-template-columns:8rem 1fr 2rem}}
`;

function metric(label, value, before, { kind = 'count', lowerIsBetter = false } = {}) {
  const shown = value == null ? '–' : kind === 'dur' ? fmtDur(value) : kind === 'pct' ? `${value}%` : String(value);
  let delta = '<span class="delta same">No earlier data to compare</span>';
  if (before != null && value != null) {
    const diff = value - before;
    if (diff === 0) delta = '<span class="delta same">Same as the previous period</span>';
    else {
      const good = lowerIsBetter ? diff < 0 : diff > 0;
      const amount = kind === 'dur' ? fmtDur(Math.abs(diff)) : kind === 'pct' ? `${Math.abs(diff)} pts` : Math.abs(diff);
      delta = `<span class="delta ${good ? 'good' : 'bad'}">${diff > 0 ? '▲ up' : '▼ down'} ${esc(amount)} vs previous period</span>`;
    }
  }
  return `<div class="metric"><p>${esc(label)}</p><b>${esc(shown)}</b>${delta}</div>`;
}

function heatmap(data) {
  const days = [];
  for (let t = data.window.from.getTime(); t < data.window.to.getTime(); t += DAY) days.push(new Date(t));
  const counts = {};
  for (const run of data.runs) {
    const key = `${run.project}|${run.date.toISOString().slice(0, 10)}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const max = Math.max(1, ...Object.values(counts));
  const rows = data.projects.map((name) => `<tr><th scope="row">${esc(name)}</th>${days.map((d) => {
    const n = counts[`${name}|${d.toISOString().slice(0, 10)}`] || 0;
    const pct = n ? Math.round(15 + 40 * (n / max)) : 0;
    return `<td><div class="cell" style="--o:${pct}%" title="${esc(`${name}, ${fmtDate(d)}: ${n} run${n === 1 ? '' : 's'}`)}">${n || ''}</div></td>`;
  }).join('')}</tr>`).join('');
  return `<p class="hint">Scroll sideways to see every day →</p><div class="scroll" tabindex="0" role="region" aria-label="Activity per day"><table class="heat"><thead><tr><th></th>${days.map((d) => `<th scope="col">${esc(fmtDate(d))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function stageBars(runs) {
  const max = Math.max(1, ...runs.map(cycle));
  const rows = runs.map((run) => {
    const segs = STAGES.map(([name]) => (run.stages[name] ? `<span class="seg ${name}" style="width:${(run.stages[name] / max) * 100}%" title="${esc(`${name}: ${fmtDur(run.stages[name])}`)}"></span>` : '')).join('');
    const detail = STAGES.filter(([name]) => run.stages[name]).map(([name]) => `${name} ${fmtDur(run.stages[name])}`).join(' · ');
    return `<div class="barrow"><div class="barlabel"><b>${esc(run.title)}</b><span>${esc(run.project)} · ${esc(run.state)}</span></div><div class="bar" aria-hidden="true">${segs}</div><div class="bartotal">${esc(fmtDur(cycle(run)))}</div><div class="bardetail">${esc(detail || 'no stage timestamps')}</div></div>`;
  }).join('');
  const legend = STAGES.map(([name]) => `<span><i class="seg ${name}"></i>${name}</span>`).join('');
  return `<div class="bars">${rows}</div><div class="legend">${legend}</div>`;
}

function causes(metrics) {
  const entries = Object.entries(metrics.causes).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<p class="muted">No ITERATE verdicts in this period.</p>';
  const max = entries[0][1];
  return `<div class="causes">${entries.map(([cause, n]) => `<div class="cause"><span>${esc(cause)}</span><span class="track"><i style="width:${(n / max) * 100}%"></i></span><span>${n}</span></div>`).join('')}</div>`;
}

function evidence(run) {
  const acs = run.acs.map((ac) => {
    const passed = /^(pass|met|ok|verified)$/i.test(String(ac.status || ''));
    return `<li><span class="pill ${passed ? 'ok' : ac.status ? 'warn' : 'muted'}">${esc(ac.status || 'no status')}</span><b>${esc(ac.id)}</b> ${esc(ac.statement)}${ac.evidence ? `<p class="ev">${esc(ac.evidence.slice(0, 400))}</p>` : ''}</li>`;
  }).join('');
  const commands = run.commands.map((c) => `<li><span class="pill ${c.exitCode === 0 ? 'ok' : 'bad'}">exit ${esc(c.exitCode)}</span><code>${esc(c.command)}</code> <span class="muted">${esc(fmtDur(c.durationMs))}</span></li>`).join('');
  const links = Object.entries(run.files).map(([name, file]) => `<a href="${esc(fileUrl(file))}">${esc(name)}</a>`).join('');
  return `<details><summary>Evidence<span class="sr"> for ${esc(run.title)}</span></summary>
<h4>Acceptance criteria</h4><ul class="list">${acs || '<li class="muted">None recorded</li>'}</ul>
<h4>Verification commands</h4><ul class="list">${commands || '<li class="muted">None recorded</li>'}</ul>
${run.verdictReason ? `<h4>Judge reason</h4><p>${esc(run.verdictReason)}</p>` : ''}
${run.outOfMap.length ? `<h4>Changed outside the impact map (${run.outOfMap.length})</h4><p class="muted">${run.outOfMap.map(esc).join(', ')}</p>` : ''}
${links ? `<h4>Artifacts</h4><p class="files">${links}</p>` : ''}
</details>`;
}

function featureCard(run) {
  const n = run.iterations.length;
  const green = run.commands.filter((c) => c.exitCode === 0).length;
  const tags = [
    run.verdict ? `<span class="pill ${run.verdict === 'PASS' ? 'ok' : 'warn'}">${esc(run.verdict)}</span>` : `<span class="pill muted">${esc(run.state)}</span>`,
    run.tier ? `<span class="pill info">${esc(run.tier)}</span>` : '',
    n ? `<span class="pill ${n > 1 ? 'warn' : 'ok'}">${n} iteration${n > 1 ? 's' : ''}</span>` : '',
    run.commands.length ? `<span class="pill ${green === run.commands.length ? 'ok' : 'bad'}">${green}/${run.commands.length} checks green</span>` : '',
    run.outOfMap.length ? `<span class="pill warn">${run.outOfMap.length} outside impact map</span>` : '',
    run.openFindings ? `<span class="pill warn">${run.openFindings} open findings</span>` : ''
  ].join('');
  const meta = [esc(run.project), esc(fmtDate(run.date)), run.branch ? `<code>${esc(run.branch)}</code>` : '', run.approvedBy ? `approved by ${esc(run.approvedBy)}` : ''].filter(Boolean);
  return `<article class="feature"><header><div><h3 style="max-width:60ch">${esc(run.title)}</h3><p>${meta.join(' · ')}</p></div><div class="tags">${tags}</div></header>${evidence(run)}</article>`;
}

function clientView(data) {
  const delivered = data.runs.filter((run) => run.delivered).reverse();
  const items = delivered.map((run) => {
    const green = run.commands.filter((c) => c.exitCode === 0).length;
    const first = run.clientText.split(/(?<=[.!?])\s/)[0];
    const heading = run.title.length <= 80 ? run.title : first;
    const body = heading === first ? run.clientText.slice(first.length).trim() : run.clientText;
    return `<li><time>${esc(fmtDate(run.endedAt))}</time><div><span class="pill info">New</span><h3>${esc(heading)}</h3>${body ? `<p>${esc(body)}</p>` : ''}<p class="proof">Verified: ${run.acs.length} criteria checked, ${green} automated check${green === 1 ? '' : 's'} passed</p></div></li>`;
  }).join('');
  const now = data.runs.filter((run) => !run.delivered && !/ABANDON/.test(run.state));
  return `<div class="panel"><h2>What's new</h2>${items ? `<ol class="timeline">${items}</ol>` : '<p class="empty">Nothing was delivered in this period.</p>'}</div><div class="panel"><h2>In progress now</h2>${now.length ? `<div class="now">${now.map((run) => `<div><h3>${esc(run.title)}</h3><p class="muted">${esc(run.clientText)}</p></div>`).join('')}</div>` : '<p class="muted">Nothing in progress.</p>'}</div>`;
}

function renderRecap(data, { audience = 'me', now = new Date(), lang = null } = {}) {
  if (!AUDIENCES.includes(audience)) throw new Error('--for must be me, lead or client');
  const { metrics, previous: prev, runs } = data;
  const contentLang = lang ? ` lang="${esc(lang)}"` : '';
  const technical = runs.filter((run) => run.delivered && run.clientTextSource === 'objective');
  const empty = `<p class="empty">No runs in the last ${esc(data.window.days)} days. Try a longer window: <code>ael recap --days ${esc(data.window.days * 4)}</code></p>`;
  const me = runs.length ? `<div class="metrics">${metric('Runs', metrics.runs, prev?.runs)}${metric('Passed on the first try', metrics.firstPassRate, prev?.firstPassRate, { kind: 'pct' })}${metric('Median cycle time', metrics.medianCycleMs, prev?.medianCycleMs, { kind: 'dur', lowerIsBetter: true })}${metric('Delivered', metrics.delivered, prev?.delivered)}${metric('Times you had to step in, per run', metrics.interventionsPerRun, prev?.interventionsPerRun, { lowerIsBetter: true })}</div>
<div class="panel"><h2>Activity per day</h2>${heatmap(data)}</div>
<div class="panel"><h2>Where the time went</h2>${stageBars(runs)}</div>
<div class="panel"><h2>Why runs had to iterate</h2>${causes(metrics)}</div>` : `<div class="panel">${empty}</div>`;
  const lead = runs.length ? `<div class="metrics">${metric('Delivered', metrics.delivered, prev?.delivered)}${metric('Passed on the first try', metrics.firstPassRate, prev?.firstPassRate, { kind: 'pct' })}${metric('Median cycle time', metrics.medianCycleMs, prev?.medianCycleMs, { kind: 'dur', lowerIsBetter: true })}${metric('High-risk (T2) runs', metrics.t2, prev?.t2, { lowerIsBetter: true })}${metric('Times a human stepped in, per run', metrics.interventionsPerRun, prev?.interventionsPerRun, { lowerIsBetter: true })}</div>${technical.length ? `<div class="panel"><h2>Before you share the client tab</h2><p>${technical.length} delivered run${technical.length === 1 ? ' has' : 's have'} no <code>plainSummary</code>, so the client tab shows the technical objective: ${technical.map((run) => `<b>${esc(run.title)}</b>`).join(', ')}. Add a one-sentence <code>plainSummary</code> to the Goal and rerun the recap.</p></div>` : ''}<h2>Work and its evidence</h2><div${contentLang}>${runs.slice().reverse().map(featureCard).join('')}</div>` : `<div class="panel">${empty}</div>`;
  const tab = (view, text) => `<button type="button" aria-controls="${view}" data-view="${view}" aria-pressed="${view === audience}">${text}</button>`;
  const section = (view, html) => `<section class="view${view === audience ? ' on' : ''}" id="${view}" aria-label="${esc({ me: 'For me', lead: 'For the lead', client: 'For the client' }[view])}">${html}</section>`;
  const range = `${fmtDate(data.window.from)} – ${fmtDate(new Date(data.window.to.getTime() - 1))}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(`AEL recap · ${range}`)}</title><style>${STYLE}</style></head><body><main class="wrap">
<header class="top"><div><p class="kicker">AEL recap · last ${esc(data.window.days)} day${data.window.days === 1 ? '' : 's'}</p><h1>${esc(range)}</h1></div><p class="scope">${esc(data.projects.join(' · '))}<br>${metrics.runs} run${metrics.runs === 1 ? '' : 's'} · ${metrics.delivered} delivered</p></header>
<nav class="tabs" aria-label="Audience">${tab('me', 'For me')}${tab('lead', 'For the lead')}${tab('client', 'For the client')}</nav>
${section('me', `<div${contentLang}>${me}</div>`)}
${section('lead', lead)}
${section('client', `<div${contentLang}>${clientView(data)}</div>`)}
<footer>Built from local AEL run artifacts on ${esc(now.toISOString().slice(0, 16).replace('T', ' '))} UTC. Every number comes from a Run file; nothing is written by a model.</footer>
</main><script>document.documentElement.classList.add('js');document.querySelectorAll('.tabs button').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('.tabs button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});document.querySelectorAll('section.view').forEach(function(s){s.classList.toggle('on',s.id===b.dataset.view);});});});</script></body></html>`;
}

module.exports = { AUDIENCES, renderRecap };
