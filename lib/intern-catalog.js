'use strict';

const HOST_MODEL_LIST_COMMANDS = ['grok models', '/models'];

function parseGrokModelsOutput(text) {
  const models = [];
  let defaultModel = '';
  const raw = String(text || '');
  const def = raw.match(/Default model:\s*(\S+)/i);
  if (def) defaultModel = def[1];
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*[-*]\s+(\S+)/);
    if (!match) continue;
    const id = match[1].replace(/\(default\)/i, '').trim();
    if (id && !models.includes(id)) models.push(id);
  }
  return { defaultModel, models };
}

function isCodingInternModel(id) {
  const s = String(id || '').toLowerCase();
  if (!s) return false;
  if (/imagine/.test(s)) return false;
  if (/(^|-)video($|-)/.test(s)) return false;
  return true;
}

function codingInternModels(models) {
  return (models || []).filter(isCodingInternModel);
}

function formatInternPickList(models) {
  const lines = ['0) none (Recommended)'];
  codingInternModels(models).forEach((id, i) => {
    lines.push(`${i + 1}) ${id}`);
  });
  return lines.join('\n');
}

function internInCatalog(id, models) {
  const s = String(id || '').trim();
  if (!s || /^none$/i.test(s)) return true;
  return codingInternModels(models).includes(s);
}

module.exports = {
  HOST_MODEL_LIST_COMMANDS,
  parseGrokModelsOutput,
  isCodingInternModel,
  codingInternModels,
  formatInternPickList,
  internInCatalog
};
