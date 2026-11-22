'use strict';

const MAX_WORDS = { instruction: 20, description: 25 };
const VAGUE = ['should', 'might', 'could', 'would', 'may', 'maybe', 'probably', 'possibly', 'some', 'various', 'etc', 'and/or', 'appropriate', 'properly', 'correctly', 'as needed', 'if necessary', 'user-friendly', 'robust', 'seamless', 'fast', 'easy'];
const PASSIVE = /\b(is|are|was|were|be|been|being|gets|got)\s+(\w+ly\s+)?(\w+ed|built|done|made|shown|sent|set|written|given|taken|seen|known|found|kept|held|read|run|left|put|shut|split|spent|chosen|broken)\b/i;
const IMPERATIVE_HINT = /^(add|remove|show|hide|send|save|open|close|keep|use|return|reject|accept|write|read|run|stop|start|set|make|create|delete|update|move|check|display|export|import|log|block|allow)\b/i;

const ING_NOT_PARTICIPLE = new Set(['missing', 'existing', 'pending', 'failing', 'matching', 'remaining', 'incoming', 'outgoing', 'ongoing', 'upcoming', 'following', 'leading', 'trailing', 'running', 'loading', 'during', 'nothing', 'something', 'anything', 'everything', 'string', 'strings', 'thing', 'things', 'ping', 'ring', 'king', 'spring', 'bring', 'sing', 'wing']);
const PARTICIPLE_PHRASE = /^(\w+ing)\s+(?:(?:the|a|an|this|that|these|those|its|their|his|her|our|your|all|each|every|some|any)\b|[^,.;]{0,40},)/i;

function participleOpening(sentence) {
  const match = sentence.match(PARTICIPLE_PHRASE);
  return Boolean(match) && !ING_NOT_PARTICIPLE.has(match[1].toLowerCase());
}

const words = (sentence) => sentence.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word));

function sentences(text) {
  return String(text || '')
    .replace(/`[^`]*`/g, 'CODE')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function steFindings(text, { kind = 'description' } = {}) {
  const findings = [];
  const limit = MAX_WORDS[kind] || MAX_WORDS.description;
  for (const sentence of sentences(text)) {
    const count = words(sentence).length;
    if (count > limit) findings.push({ rule: 'length', detail: `${count} words; keep ${kind} sentences at ${limit} or fewer` });
    if (PASSIVE.test(sentence)) findings.push({ rule: 'active-voice', detail: `passive "${sentence.match(PASSIVE)[0]}"; say who does what` });
    const lower = ` ${sentence.toLowerCase().replace(/[^a-z/\s-]/g, ' ')} `;
    const vague = VAGUE.filter((word) => lower.includes(` ${word} `));
    if (vague.length) findings.push({ rule: 'precise-words', detail: `vague: ${vague.join(', ')}; use a word a test can check` });
    if (kind === 'instruction' && (sentence.match(/\b(and then|then|and also)\b/gi) || []).length) findings.push({ rule: 'one-instruction', detail: 'more than one action; write one sentence per action' });
    if (participleOpening(sentence) && !IMPERATIVE_HINT.test(sentence)) findings.push({ rule: 'no-ing-start', detail: 'starts with an -ing word; start with the subject or the verb' });
  }
  return findings;
}

function goalReadability(goal) {
  const out = [];
  const add = (field, text, kind) => {
    for (const finding of steFindings(text, { kind })) out.push({ field, ...finding });
  };
  add('objective', goal?.objective, 'description');
  if (goal?.plainSummary) add('plainSummary', goal.plainSummary, 'description');
  for (const criterion of goal?.acceptanceCriteria || []) {
    add(`${criterion.id}.statement`, criterion.statement, 'description');
    (criterion.failureCases || []).forEach((item, index) => add(`${criterion.id}.failureCases[${index}]`, item, 'description'));
  }
  return out;
}

const line = (text) => String(text || '').replace(/\s+/g, ' ').trim();

function renderHumanGoal(goal, { runId = goal?.runId, revision = null } = {}) {
  const parts = [`# Goal${runId ? ` for Run ${runId}` : ''}${revision != null ? ` (revision ${revision})` : ''}`, ''];
  const restate = goal?.restatement;
  if (restate && typeof restate === 'object' && !Array.isArray(restate)) {
    parts.push(
      '## Restate',
      '',
      `Problem: ${line(restate.problem)}`,
      '',
      `Done when: ${line(restate.doneWhen)}`,
      '',
      `Fail if: ${line(restate.failIf)}`,
      '',
      `Unknowns: ${line(restate.unknowns)}`,
      ''
    );
  }
  parts.push('## What changes', '', line(goal?.plainSummary || goal?.objective), '');
  parts.push('## Done when', '');
  for (const criterion of goal?.acceptanceCriteria || []) {
    parts.push(`${criterion.id}. ${line(criterion.statement)}`);
    parts.push(`   - Proof: ${line(criterion.evidenceRequired)}.`.replace(/\.\.$/, '.'));
    for (const failure of criterion.failureCases || []) parts.push(`   - Fail if: ${line(failure)}`);
  }
  parts.push('');
  if ((goal?.outOfScope || []).length) parts.push('## Not in this change', '', ...goal.outOfScope.map((item) => `- ${line(item)}`), '');
  const statements = goal?.statements || [];
  const unconfirmed = statements.filter((item) => item.kind === 'assumption');
  if (unconfirmed.length) parts.push('## Not confirmed yet', '', ...unconfirmed.map((item) => `- ${line(item.text)}`), '');
  const findings = goalReadability(goal);
  if (findings.length) parts.push('## Writing checks (STE style, not blocking)', '', ...findings.map((item) => `- ${item.field}: ${item.detail}`), '');
  return `${parts.join('\n').trimEnd()}\n`;
}

module.exports = { MAX_WORDS, goalReadability, renderHumanGoal, steFindings };
