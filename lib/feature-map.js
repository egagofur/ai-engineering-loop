'use strict';

// Feature map (C-22, "All Code Is Slop (Except Mine)" 10:06-10:46): a
// site map of what users can do, so agents stop guessing what "the thingy in
// the left sidebar" means and runtime verification has a shared vocabulary.
// .ai-engineering-loop/feature-map.md holds one Markdown table:
//
// | Feature | Where (UI or endpoint) | Paths | How to reach | Driver |
// |---|---|---|---|---|
// | export-csv | Reports > Export button | src/reports/**, src/export/** | open Reports, click Export | npm run drive -- export |
//
// `Paths` are globs (comma separated) used to pick the entries a diff
// touches; `Driver` is an optional reusable command that runs the flow.

const fs = require('fs');
const path = require('path');
const { matchesGlob } = require('./impact-map.js');

const FEATURE_MAP_FILE = path.join('.ai-engineering-loop', 'feature-map.md');

function parseFeatureMap(text) {
  const entries = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4 || /^feature$/i.test(cells[0])) continue;
    entries.push({
      id: cells[0],
      where: cells[1],
      paths: cells[2].split(',').map((glob) => glob.trim().replace(/`/g, '')).filter(Boolean),
      how: cells[3],
      driver: (cells[4] || '').replace(/`/g, '').trim() || null
    });
  }
  return entries;
}

function loadFeatureMap(rootDir) {
  try {
    return parseFeatureMap(fs.readFileSync(path.join(rootDir, FEATURE_MAP_FILE), 'utf8'));
  } catch {
    return [];
  }
}

function featuresForFiles(rootDir, files) {
  return loadFeatureMap(rootDir).filter((entry) => files.some((file) => entry.paths.some((glob) => matchesGlob(file, glob))));
}

function renderForPack(entries) {
  if (!entries.length) return '';
  return ['', '## Features this change touches (feature map)', '',
    ...entries.map((entry) => `- ${entry.id}: ${entry.where}. Reach: ${entry.how}.${entry.driver ? ` Driver: \`${entry.driver}\`` : ''}`)].join('\n');
}

module.exports = { FEATURE_MAP_FILE, featuresForFiles, loadFeatureMap, parseFeatureMap, renderForPack };
