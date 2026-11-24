'use strict';

const fs = require('fs');
const path = require('path');

const MAX_DINERS = 6;
const MAX_NAME = 40;
const MAX_NOTE = 60;
const DINERS_FILE = path.join(__dirname, '..', '..', 'studio', 'diners.json');

const FALLBACK_DINERS = Object.freeze([]);

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text && text.length <= max ? text : null;
}

function validDiners(list) {
  if (!Array.isArray(list)) return [];
  const diners = [];
  for (const entry of list) {
    if (diners.length >= MAX_DINERS) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const name = cleanText(entry.name, MAX_NAME);
    if (!name) continue;
    const note = entry.note === undefined ? null : cleanText(entry.note, MAX_NOTE);
    diners.push(note ? { name, note } : { name });
  }
  return diners;
}

function parseDiners(config) {
  return validDiners(config && config.studio && config.studio.diners);
}

function defaultDiners(file = DINERS_FILE) {
  try {
    return validDiners(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return FALLBACK_DINERS.map((diner) => ({ ...diner }));
  }
}

function studioDiners(config, { file = DINERS_FILE } = {}) {
  const custom = parseDiners(config);
  return { diners: custom.length ? custom : defaultDiners(file), customDiners: custom.length > 0 };
}

module.exports = { DINERS_FILE, FALLBACK_DINERS, MAX_DINERS, MAX_NAME, MAX_NOTE, defaultDiners, parseDiners, studioDiners, validDiners };
