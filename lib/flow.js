'use strict';

const MAX_STEPS = 40;
const MAX_EFFECTS = 12;
const VIEWS = ['state', 'storyboard', 'lanes'];
const PREFERENCES = ['auto', ...VIEWS, 'off'];
const TERMINAL = /^(done|end|closed|success|error|failed|cancel(l)?ed)$/i;

const text = (value) => String(value ?? '').trim();

function flowProblems(flow, { acIds = null, forbidden = null } = {}) {
  if (flow == null) return [];
  if (!Array.isArray(flow) || !flow.length) return ['flow must be a non-empty array of {from, event, to}'];
  const problems = [];
  if (flow.length > MAX_STEPS) problems.push(`flow may have at most ${MAX_STEPS} steps (has ${flow.length}); split it into smaller Goals`);
  const knownAcs = acIds ? new Set(acIds) : null;
  flow.forEach((step, index) => {
    for (const field of ['from', 'event', 'to']) {
      if (!text(step?.[field])) problems.push(`flow[${index}].${field} is required`);
    }
    if (step?.hotspot !== undefined && step.hotspot !== true && (typeof step.hotspot !== 'string' || !text(step.hotspot))) {
      problems.push(`flow[${index}].hotspot must be a question (string) or true`);
    }
    if (step?.effects === undefined) return;
    if (!Array.isArray(step.effects)) {
      problems.push(`flow[${index}].effects must be an array`);
      return;
    }
    if (step.effects.length > MAX_EFFECTS) problems.push(`flow[${index}].effects may have at most ${MAX_EFFECTS} items`);
    step.effects.forEach((effect, effectIndex) => {
      if (!text(effect?.text)) problems.push(`flow[${index}].effects[${effectIndex}].text is required`);
      if (effect?.ac !== undefined && knownAcs && !knownAcs.has(effect.ac)) {
        problems.push(`flow[${index}].effects[${effectIndex}].ac ${effect.ac} is not an acceptance criterion id`);
      }
    });
  });
  if (forbidden != null) {
    if (!Array.isArray(forbidden)) {
      problems.push('forbiddenTransitions must be an array of {from, event}');
    } else {
      const states = new Set(flow.flatMap((step) => [step?.from, step?.to]));
      const events = new Set(flow.map((step) => step?.event));
      forbidden.forEach((pair, index) => {
        if (!states.has(pair?.from)) problems.push(`forbiddenTransitions[${index}].from "${pair?.from}" is not a state in flow`);
        if (!events.has(pair?.event)) problems.push(`forbiddenTransitions[${index}].event "${pair?.event}" is not an event in flow`);
      });
    }
  }
  return problems;
}

function flowWarnings(flow) {
  if (flowProblems(flow).length || !flow) return [];
  const start = flow[0].from;
  const sources = new Set(flow.map((step) => step.from));
  const targets = new Set(flow.map((step) => step.to));
  const states = [...new Set(flow.flatMap((step) => [step.from, step.to]))];
  const warnings = [];
  for (const state of states) {
    if (state !== start && !targets.has(state)) warnings.push(`"${state}" is never reached from another state`);
    if (!sources.has(state) && !TERMINAL.test(state)) {
      warnings.push(`"${state}" has no way out; mark it terminal (Done/Error) or add the next step`);
    }
  }
  return warnings;
}

function flowActors(flow) {
  return [...new Set((flow || []).map((step) => text(step.actor) || 'user'))];
}

function orderedStates(flow) {
  return [...new Set(flow.flatMap((step) => [step.from, step.to]))];
}

function transitionTable(goal) {
  const flow = goal?.flow || [];
  const events = [...new Set(flow.map((step) => step.event))];
  const fromStates = [...new Set(flow.map((step) => step.from))];
  const endStates = orderedStates(flow).filter((state) => !fromStates.includes(state));
  const forbidden = new Set((goal?.forbiddenTransitions || []).map((pair) => `${pair.from}\u0000${pair.event}`));
  const rows = fromStates.map((state) => {
    const cells = {};
    for (const event of events) {
      const steps = flow.filter((step) => step.from === state && step.event === event);
      const targets = steps.map((step) => ({ to: step.to, guard: text(step.guard) || null, hotspot: step.hotspot || null }));
      if (!steps.length) {
        cells[event] = { kind: forbidden.has(`${state}\u0000${event}`) ? 'invalid' : 'undecided', targets: [] };
      } else if (steps.length === 1) {
        cells[event] = { kind: 'target', targets };
      } else {
        const guards = targets.map((target) => target.guard);
        const distinct = guards.every(Boolean) && new Set(guards).size === guards.length;
        cells[event] = { kind: distinct ? 'targets' : 'conflict', targets };
      }
    }
    return { state, cells };
  });
  return { states: orderedStates(flow), events, rows, endStates };
}

function flowCounts(goal) {
  const flow = goal?.flow || [];
  const table = transitionTable(goal);
  const cells = table.rows.flatMap((row) => Object.values(row.cells));
  return {
    undecided: cells.filter((cell) => cell.kind === 'undecided').length,
    hotspots: flow.filter((step) => step.hotspot).length + cells.filter((cell) => cell.kind === 'conflict').length,
    sideEffects: flow.reduce((sum, step) => sum + (step.effects || []).filter((effect) => !effect.ac).length, 0)
  };
}

function diagramOptions(goal, { preference = 'auto' } = {}) {
  const flow = goal?.flow;
  if (!Array.isArray(flow) || !flow.length || preference === 'off') return [];
  const actors = flowActors(flow);
  const rules = {
    state: [Boolean(text(goal.flowSubject)), `the Goal changes the status of ${text(goal.flowSubject) || 'an entity'}`],
    storyboard: [actors.every((actor) => actor === 'user'), 'every step is a user action'],
    lanes: [actors.length >= 2 && actors.some((actor) => actor !== 'user'), `steps run across ${actors.join(', ')}`]
  };
  const fixed = VIEWS.includes(preference) ? preference : null;
  const options = VIEWS.map((view) => ({
    view,
    recommended: fixed ? view === fixed : rules[view][0],
    reason: fixed && view === fixed ? 'project default (freeze_diagram)' : rules[view][1]
  }));
  if (!options.some((option) => option.recommended)) options.find((option) => option.view === 'state').recommended = true;
  return [...options.filter((option) => option.recommended), ...options.filter((option) => !option.recommended)];
}

const cell = (value) => String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

function renderFlow(flow) {
  if (!Array.isArray(flow) || !flow.length) return '';
  return ['| From | Event | To |', '|---|---|---|', ...flow.map((step) => `| ${cell(step.from)} | ${cell(step.event)} | ${cell(step.to)} |`)].join('\n');
}

function mermaidText(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/;/g, ',')
    .replace(/#/g, 'no. ')
    .replace(/[{}<>]/g, '')
    .trim();
}

function renderMermaid(flow) {
  if (!Array.isArray(flow) || !flow.length || flowProblems(flow).length) return '';
  const ids = new Map();
  const idOf = (state) => {
    if (!ids.has(state)) ids.set(state, `s${ids.size}`);
    return ids.get(state);
  };
  for (const step of flow) {
    idOf(step.from);
    idOf(step.to);
  }
  const sources = new Set(flow.map((step) => step.from));
  const lines = ['stateDiagram-v2'];
  for (const [state, id] of ids) lines.push(`  state "${mermaidText(state)}" as ${id}`);
  lines.push(`  [*] --> ${idOf(flow[0].from)}`);
  for (const step of flow) lines.push(`  ${idOf(step.from)} --> ${idOf(step.to)}: ${mermaidText(step.event)}`);
  for (const [state, id] of ids) {
    if (!sources.has(state) && TERMINAL.test(state)) lines.push(`  ${id} --> [*]`);
  }
  return lines.join('\n');
}

module.exports = { MAX_EFFECTS, MAX_STEPS, PREFERENCES, VIEWS, diagramOptions, flowActors, flowCounts, flowProblems, flowWarnings, renderFlow, renderMermaid, transitionTable };
