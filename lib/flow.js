'use strict';

// Goal `flow` (C-21, "All Code Is Slop (Except Mine)" 12:46): a small state
// machine from the user's point of view, so a human can check that the agent
// understood the intent before any code exists, and review it again next to
// the verification artifacts. Plain Markdown tables (no diagram engine), so
// it renders on every host and in every PR.
//
// "flow": [ { "from": "List", "event": "click Export", "to": "Exporting" }, ... ]

function flowProblems(flow) {
  if (flow == null) return [];
  if (!Array.isArray(flow) || !flow.length) return ['flow must be a non-empty array of {from, event, to}'];
  const problems = [];
  flow.forEach((step, index) => {
    for (const field of ['from', 'event', 'to']) {
      if (!String(step?.[field] || '').trim()) problems.push(`flow[${index}].${field} is required`);
    }
  });
  return problems;
}

// Warnings a reviewer should look at: states nothing leads to (besides the
// first), and states with no way out that are not marked terminal.
function flowWarnings(flow) {
  if (flowProblems(flow).length || !flow) return [];
  const start = flow[0].from;
  const sources = new Set(flow.map((step) => step.from));
  const targets = new Set(flow.map((step) => step.to));
  const states = [...new Set(flow.flatMap((step) => [step.from, step.to]))];
  const warnings = [];
  for (const state of states) {
    if (state !== start && !targets.has(state)) warnings.push(`"${state}" is never reached from another state`);
    if (!sources.has(state) && !/^(done|end|closed|success|error|failed|cancel(l)?ed)$/i.test(state)) {
      warnings.push(`"${state}" has no way out; mark it terminal (Done/Error) or add the next step`);
    }
  }
  return warnings;
}

const cell = (value) => String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

function renderFlow(flow) {
  if (!Array.isArray(flow) || !flow.length) return '';
  return ['| From | Event | To |', '|---|---|---|', ...flow.map((step) => `| ${cell(step.from)} | ${cell(step.event)} | ${cell(step.to)} |`)].join('\n');
}

module.exports = { flowProblems, flowWarnings, renderFlow };
