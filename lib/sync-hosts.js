'use strict';

const fs = require('fs');
const path = require('path');
const { AGENTS, renderAgent, agentFileName } = require('./hosts/agent-formats.js');
const {
  homeDir,
  sha256,
  userStatePath,
  readJsonFile,
  writeJsonFile,
  readUserConfig,
  writeUserConfig
} = require('./user-state.js');

function packageRoot() {
  return path.join(__dirname, '..');
}

// Host packs. `core` is always installed; the others are opt-in so unrelated
// skills do not enter every session's skill index (issue #31).
const HOST_PACKS = Object.freeze(['core', 'backend', 'design', 'quality']);
const DEFAULT_HOST_PACKS = Object.freeze(['core']);
const MANIFEST_FILE = 'host-manifest.json';

const BACKEND_SKILL_FILES = [
  'SKILL.md',
  'references/api-design-guidelines.md',
  'references/query-and-database-best-practices.md',
  'references/security-checklist.md'
];

const EMIL_KOWALSKI_SKILLS = Object.freeze([
  'animate',
  'animate-expo',
  'animation-vocabulary',
  'apple-design',
  'ask-sonner',
  'emil-design-eng',
  'find-animation-opportunities',
  'improve-animations',
  'mobile-native',
  'pick-ui-library',
  'prototype',
  'review-animations',
  'write-swift'
]);

const EMIL_KOWALSKI_SKILL_FILES = Object.freeze({
  animate: ['SKILL.md', 'RECIPES.md'],
  'animate-expo': ['SKILL.md', 'RECIPES.md'],
  'animation-vocabulary': ['SKILL.md'],
  'apple-design': ['SKILL.md'],
  'ask-sonner': ['SKILL.md', 'API.md'],
  'emil-design-eng': ['SKILL.md'],
  'find-animation-opportunities': ['SKILL.md'],
  'improve-animations': ['SKILL.md', 'AUDIT.md', 'PLAN-TEMPLATE.md'],
  'mobile-native': ['SKILL.md'],
  'pick-ui-library': ['SKILL.md'],
  prototype: ['SKILL.md', 'PICKER.md'],
  'review-animations': ['SKILL.md', 'STANDARDS.md'],
  'write-swift': ['SKILL.md']
});

function backendSkillFiles(srcRoot, destRoot) {
  return BACKEND_SKILL_FILES.map((file) => ({
    src: path.posix.join(srcRoot, file),
    dest: path.join(destRoot, file),
    mode: 'upsert',
    pack: 'backend'
  }));
}

function emilKowalskiSkillFiles(srcRoot, destRoot) {
  return EMIL_KOWALSKI_SKILLS.flatMap((skill) => (
    EMIL_KOWALSKI_SKILL_FILES[skill].map((file) => ({
      src: path.posix.join(srcRoot, skill, file),
      dest: path.join(destRoot, skill, file),
      mode: 'upsert',
      pack: 'design'
    }))
  ));
}

// Adopted skills (issue #36). project-onboarding ships with core; the quality
// pack (ael-code-simplifier, ael-receiving-code-review) is opt-in.
const QUALITY_SKILLS = Object.freeze(['ael-code-simplifier', 'ael-receiving-code-review']);

function adoptedSkillFiles(destRoot) {
  return [
    { src: 'adapters/project-onboarding/SKILL.md', dest: path.join(destRoot, 'project-onboarding/SKILL.md'), mode: 'upsert' },
    { src: 'adapters/project-onboarding/references/output.md', dest: path.join(destRoot, 'project-onboarding/references/output.md'), mode: 'upsert' },
    ...QUALITY_SKILLS.map((skill) => ({
      src: `adapters/quality/skills/${skill}/SKILL.md`,
      dest: path.join(destRoot, skill, 'SKILL.md'),
      mode: 'upsert',
      pack: 'quality'
    }))
  ];
}

// Loop stage references sit beside each host's SKILL.md (issue #35).
const LOOP_REFERENCE_FILES = Object.freeze([
  'loop-commands.md',
  'loop-deliver.md',
  'loop-goal.md',
  'loop-hosts.md',
  'loop-maker.md',
  'loop-review.md',
  'loop-risky.md',
  'loop-verify.md'
]);

function loopReferenceFiles(srcDir, destDir) {
  return LOOP_REFERENCE_FILES.map((file) => ({
    src: path.posix.join(srcDir, 'references', file),
    dest: path.join(destDir, 'references', file),
    mode: 'upsert'
  }));
}

// The host-neutral core skill (#48): one source, byte-identical everywhere.
const CORE_SKILL_SRC = '.agents/skills/ai-engineering-loop';

// Every skill a host's skill folder gets: core loop skill, helpers, packs.
function skillFolderFiles(skillsDir) {
  return [
    { src: `${CORE_SKILL_SRC}/SKILL.md`, dest: path.join(skillsDir, 'ai-engineering-loop/SKILL.md'), mode: 'upsert' },
    ...loopReferenceFiles(CORE_SKILL_SRC, path.join(skillsDir, 'ai-engineering-loop')),
    ...backendSkillFiles('.agents/skills/backend-development', path.join(skillsDir, 'backend-development')),
    ...emilKowalskiSkillFiles('.agents/skills', skillsDir),
    { src: 'adapters/dot/skills/task-impact-inquiry/SKILL.md', dest: path.join(skillsDir, 'task-impact-inquiry/SKILL.md'), mode: 'upsert' },
    { src: 'adapters/generate-adapter/SKILL.md', dest: path.join(skillsDir, 'generate-adapter/SKILL.md'), mode: 'upsert' },
    { src: 'adapters/generate-workflow/SKILL.md', dest: path.join(skillsDir, 'generate-workflow/SKILL.md'), mode: 'upsert' },
    ...adoptedSkillFiles(skillsDir)
  ];
}

function generatedAgentFiles(format, agentsDir) {
  return AGENTS.map((name) => ({
    src: `agents/shared/${name}.body.md`,
    dest: path.join(agentsDir, agentFileName(format, name)),
    mode: 'upsert',
    agentFormat: format,
    agentName: name
  }));
}

// Hosts that read the shared ~/.agents/skills folder (Codex, Gemini CLI, Grok)
// trigger it; Grok and Gemini CLI no longer get their own skill copies, which
// they would otherwise see twice. `roots` = any of these directories present.
function hostFileMap(home) {
  const claude = path.join(home, '.claude');
  const grok = path.join(home, '.grok');
  const gemini = path.join(home, '.gemini');
  const agents = path.join(home, '.agents');
  const antigravity = path.join(gemini, 'config');
  return [
    {
      id: 'claude',
      root: claude,
      files: [
        ...skillFolderFiles(path.join(claude, 'skills')),
        { src: '.claude/agents/devil-advocate.md', dest: path.join(claude, 'agents/devil-advocate.md'), mode: 'upsert' },
        { src: '.claude/agents/judge.md', dest: path.join(claude, 'agents/judge.md'), mode: 'upsert' }
      ]
    },
    {
      id: 'shared',
      root: agents,
      roots: [agents, grok, gemini, path.join(home, '.codex')],
      files: skillFolderFiles(path.join(agents, 'skills'))
    },
    {
      id: 'grok',
      root: grok,
      files: [
        { src: '.grok/agents/devil-advocate.md', dest: path.join(grok, 'agents/devil-advocate.md'), mode: 'upsert' },
        { src: '.grok/agents/judge.md', dest: path.join(grok, 'agents/judge.md'), mode: 'upsert' }
      ]
    },
    {
      id: 'antigravity',
      root: antigravity,
      roots: [antigravity, path.join(gemini, 'antigravity')],
      files: [
        ...skillFolderFiles(path.join(antigravity, 'skills')),
        ...generatedAgentFiles('antigravity-md', path.join(antigravity, 'agents'))
      ]
    },
    {
      id: 'dot',
      root: null,
      files: [
        { src: 'adapters/dot/skills/dot-dev-skill-router/SKILL.md', dest: path.join(claude, 'skills/dot-dev-skill-router/SKILL.md'), mode: 'update-if-exists', hostRoot: claude },
        { src: 'adapters/dot/skills/dot-dev-workflow/SKILL.md', dest: path.join(claude, 'skills/dot-dev-workflow/SKILL.md'), mode: 'update-if-exists', hostRoot: claude },
        { src: 'adapters/dot/skills/dot-dev-skill-router/SKILL.md', dest: path.join(grok, 'skills/dot-dev-skill-router/SKILL.md'), mode: 'update-if-exists', hostRoot: grok },
        { src: 'adapters/dot/skills/dot-dev-workflow/SKILL.md', dest: path.join(grok, 'skills/dot-dev-workflow/SKILL.md'), mode: 'update-if-exists', hostRoot: grok },
        { src: 'adapters/dot/skills/dot-dev-skill-router/SKILL.md', dest: path.join(antigravity, 'skills/dot-dev-skill-router/SKILL.md'), mode: 'update-if-exists', hostRoot: antigravity },
        { src: 'adapters/dot/skills/dot-dev-workflow/SKILL.md', dest: path.join(antigravity, 'skills/dot-dev-workflow/SKILL.md'), mode: 'update-if-exists', hostRoot: antigravity },
        { src: 'adapters/dot/skills/dot-dev-skill-router/SKILL.md', dest: path.join(agents, 'skills/dot-dev-skill-router/SKILL.md'), mode: 'update-if-exists', hostRoot: agents },
        { src: 'adapters/dot/skills/dot-dev-workflow/SKILL.md', dest: path.join(agents, 'skills/dot-dev-workflow/SKILL.md'), mode: 'update-if-exists', hostRoot: agents }
      ]
    }
  ];
}

function destExists(dest) {
  try {
    fs.lstatSync(dest);
    return true;
  } catch (e) {
    return false;
  }
}

function isSymlink(dest) {
  try {
    return fs.lstatSync(dest).isSymbolicLink();
  } catch (e) {
    return false;
  }
}

function findSymlinkAncestor(home, destination) {
  const homePath = path.resolve(home);
  const destinationPath = path.resolve(destination);
  const relative = path.relative(homePath, destinationPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;

  let current = homePath;
  const candidates = [];
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    candidates.push(current);
  }
  for (const candidate of candidates) {
    try {
      if (fs.lstatSync(candidate).isSymbolicLink()) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

function normalizePacks(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  const packs = new Set(['core']);
  for (const raw of list) {
    const pack = String(raw).trim();
    if (!pack) continue;
    if (!HOST_PACKS.includes(pack)) {
      const err = new Error(`Unknown host pack "${pack}". Use: ${HOST_PACKS.join(', ')}`);
      err.code = 'UNKNOWN_HOST_PACK';
      throw err;
    }
    packs.add(pack);
  }
  return HOST_PACKS.filter((pack) => packs.has(pack));
}

function manifestPath(home) {
  return userStatePath(MANIFEST_FILE, home);
}

function readHostManifest(home = homeDir()) {
  const value = readJsonFile(manifestPath(home), null);
  if (!value || typeof value !== 'object' || typeof value.files !== 'object' || value.files === null) {
    return { schemaVersion: 1, version: null, files: {} };
  }
  return { schemaVersion: 1, version: value.version || null, files: value.files };
}

function readFileText(dest) {
  try {
    return fs.readFileSync(dest, 'utf8');
  } catch {
    return null;
  }
}

function packageContent(root, file) {
  if (file.agentFormat) return renderAgent(root, file.agentFormat, file.agentName);
  const srcAbs = path.join(root, file.src);
  return fs.readFileSync(srcAbs, 'utf8').replace(/\r\n?/g, '\n');
}

function groupPresent(group) {
  const roots = group.roots || (group.root ? [group.root] : []);
  return roots.length === 0 || roots.some((root) => fs.existsSync(root));
}

// Pack selection precedence: explicit argument > saved user config > legacy
// auto-detect (a non-core pack stays selected while any of its files is already
// installed, so upgrading never silently freezes an existing install).
function resolvePacks({ packs, home }) {
  if (packs != null) return { packs: normalizePacks(packs), source: 'argument' };
  const config = readUserConfig(home);
  if (Array.isArray(config.hostPacks)) return { packs: normalizePacks(config.hostPacks), source: 'config' };
  const detected = new Set(DEFAULT_HOST_PACKS);
  for (const group of hostFileMap(home)) {
    for (const file of group.files) {
      if (file.pack && file.pack !== 'core' && destExists(file.dest)) detected.add(file.pack);
    }
  }
  return { packs: normalizePacks([...detected]), source: detected.size > 1 ? 'detected' : 'default' };
}

function planHostSync({ packageRoot: root = packageRoot(), home = homeDir(), packs = null, prune = false } = {}) {
  const results = [];
  const selection = resolvePacks({ packs, home });
  const manifest = readHostManifest(home);
  for (const group of hostFileMap(home)) {
    const present = groupPresent(group);
    for (const file of group.files) {
      const srcAbs = path.join(root, file.src);
      const hostRoot = file.hostRoot || null;
      const pack = file.pack || 'core';
      const item = {
        id: group.id,
        src: file.src,
        dest: file.dest,
        mode: file.mode,
        pack
      };
      if (hostRoot ? !fs.existsSync(hostRoot) : !present) {
        results.push({ ...item, action: 'skip', reason: 'host-missing' });
        continue;
      }
      if (!fs.existsSync(srcAbs)) {
        results.push({ ...item, action: 'skip', reason: 'src-missing' });
        continue;
      }
      const symlinkPath = findSymlinkAncestor(home, file.dest);
      if (symlinkPath) {
        const isDestinationSymlink = path.resolve(symlinkPath) === path.resolve(file.dest);
        results.push({
          ...item,
          action: 'skip',
          reason: isDestinationSymlink ? 'symlink' : 'symlink-ancestor'
        });
        continue;
      }
      const content = packageContent(root, file);
      const existing = destExists(file.dest) ? readFileText(file.dest) : null;
      if (!selection.packs.includes(pack)) {
        if (prune && existing !== null) {
          const tracked = manifest.files[file.dest];
          const currentHash = sha256(existing);
          const ours = (tracked && tracked.sha256 === currentHash) || existing === content;
          results.push(ours
            ? { ...item, action: 'prune' }
            : { ...item, action: 'skip', reason: 'modified' });
          continue;
        }
        results.push({ ...item, action: 'skip', reason: 'pack-not-selected' });
        continue;
      }
      if (file.mode === 'update-if-exists' && existing === null) {
        results.push({ ...item, action: 'skip', reason: 'not-installed' });
        continue;
      }
      if (existing === content) {
        results.push({ ...item, action: 'current', sha256: sha256(content) });
        continue;
      }
      const tracked = existing === null ? null : manifest.files[file.dest];
      // A file is "user-modified" when it exists and is not byte-identical to the
      // content AEL last wrote. Legacy installs without a manifest count as
      // modified, so the first managed sync keeps a backup instead of guessing.
      const backup = existing !== null && !(tracked && tracked.sha256 === sha256(existing));
      results.push({ ...item, action: 'copy', content, sha256: sha256(content), backup });
    }
  }
  // Obsolete AEL files (decision 5 on #37): recorded in the manifest by an
  // earlier sync but no longer shipped (for example a renamed skill). Removed
  // when still byte-identical to what AEL wrote; edited ones are kept.
  const known = new Set(results.map((item) => path.resolve(item.dest)));
  const hostRoots = hostFileMap(home).map((group) => path.resolve(group.root || path.dirname(group.files[0] ? group.files[0].dest : home)));
  for (const [dest, tracked] of Object.entries(manifest.files || {})) {
    const abs = path.resolve(dest);
    if (known.has(abs)) continue;
    if (!hostRoots.some((root) => abs.startsWith(root + path.sep))) continue;
    if (!destExists(abs)) {
      results.push({ id: 'obsolete', src: null, dest: abs, pack: tracked.pack || null, action: 'forget' });
      continue;
    }
    if (findSymlinkAncestor(home, abs)) continue;
    const current = readFileText(abs);
    results.push(current !== null && tracked && sha256(current) === tracked.sha256
      ? { id: 'obsolete', src: null, dest: abs, pack: tracked.pack || null, action: 'prune', reason: 'obsolete' }
      : { id: 'obsolete', src: null, dest: abs, pack: tracked.pack || null, action: 'skip', reason: 'obsolete-modified' });
  }
  results.packs = selection.packs;
  results.packSource = selection.source;
  return results;
}

// Remove directories emptied by --prune, never above <home>/.<host>/skills.
function removeEmptyParents(dir, home) {
  let current = path.resolve(dir);
  const stop = path.resolve(home);
  for (let depth = 0; depth < 3; depth += 1) {
    if (path.basename(current) === 'skills' || path.dirname(current) === stop || current === stop) return;
    try {
      if (fs.readdirSync(current).length > 0) return;
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function backupPathFor(dest) {
  const base = `${dest}.ael-backup`;
  if (!destExists(base)) return base;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base}-${stamp}`;
}

function writeNoFollow(dest, content) {
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_TRUNC
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(dest, flags, 0o600);
  try {
    fs.writeFileSync(descriptor, content);
  } finally {
    fs.closeSync(descriptor);
  }
}

function applyHostSync({
  packageRoot: root = packageRoot(),
  home = homeDir(),
  dryRun = false,
  packs = null,
  prune = false,
  version = null
} = {}) {
  const plan = planHostSync({ packageRoot: root, home, packs, prune });
  const applied = [];
  const manifest = readHostManifest(home);
  let manifestChanged = false;
  for (const item of plan) {
    if (item.action === 'current') {
      if (!dryRun && (!manifest.files[item.dest] || manifest.files[item.dest].sha256 !== item.sha256)) {
        manifest.files[item.dest] = { sha256: item.sha256, pack: item.pack };
        manifestChanged = true;
      }
      applied.push(item);
      continue;
    }
    if (item.action === 'prune') {
      if (!dryRun) {
        fs.unlinkSync(item.dest);
        removeEmptyParents(path.dirname(item.dest), home);
        delete manifest.files[item.dest];
        manifestChanged = true;
      }
      applied.push({ ...item, dryRun });
      continue;
    }
    if (item.action === 'forget') {
      if (!dryRun) {
        delete manifest.files[item.dest];
        manifestChanged = true;
      }
      continue;
    }
    if (item.action !== 'copy') {
      applied.push(item);
      continue;
    }
    if (dryRun) {
      applied.push({ ...item, content: undefined, dryRun });
      continue;
    }
    if (findSymlinkAncestor(home, item.dest)) {
      applied.push({ ...item, action: 'skip', reason: 'symlink-ancestor', content: undefined });
      continue;
    }
    fs.mkdirSync(path.dirname(item.dest), { recursive: true });
    if (findSymlinkAncestor(home, item.dest)) {
      applied.push({ ...item, action: 'skip', reason: 'symlink-ancestor', content: undefined });
      continue;
    }
    let backupPath = null;
    if (item.backup) {
      backupPath = backupPathFor(item.dest);
      writeNoFollow(backupPath, fs.readFileSync(item.dest));
    }
    writeNoFollow(item.dest, item.content);
    manifest.files[item.dest] = { sha256: item.sha256, pack: item.pack };
    manifestChanged = true;
    applied.push({ ...item, content: undefined, dryRun, backupPath });
  }
  if (!dryRun && manifestChanged) {
    writeJsonFile(manifestPath(home), {
      schemaVersion: 1,
      version: version || manifest.version || null,
      updatedAt: new Date().toISOString(),
      files: manifest.files
    });
  } else if (!dryRun && version && manifest.version !== version && Object.keys(manifest.files).length > 0) {
    writeJsonFile(manifestPath(home), { ...manifest, version, updatedAt: new Date().toISOString() });
  }
  if (!dryRun && packs != null) writeUserConfig({ hostPacks: plan.packs }, home);
  applied.packs = plan.packs;
  applied.packSource = plan.packSource;
  return applied;
}

function hostSkillStatus({ packageRoot: root = packageRoot(), home = homeDir(), version = null } = {}) {
  const plan = planHostSync({ packageRoot: root, home });
  const staleFiles = plan.filter((item) => item.action === 'copy').length;
  const managedFiles = plan.filter((item) => item.action === 'current').length;
  const manifest = readHostManifest(home);
  return {
    installedVersion: manifest.version,
    packageVersion: version,
    stale: staleFiles > 0,
    staleFiles,
    managedFiles,
    packs: plan.packs,
    packSource: plan.packSource
  };
}

function summarizeHostSync(results) {
  const summary = { copy: 0, current: 0, skip: 0, backup: 0, prune: 0 };
  for (const item of results) {
    if (item.action === 'copy') {
      summary.copy += 1;
      if (item.backup) summary.backup += 1;
    } else if (item.action === 'current') summary.current += 1;
    else if (item.action === 'prune') summary.prune += 1;
    else summary.skip += 1;
  }
  return summary;
}

const QUIET_SKIP_REASONS = new Set(['host-missing', 'not-installed', 'pack-not-selected']);

function formatHostSyncReport(results, { version, dryRun = false } = {}) {
  const summary = summarizeHostSync(results);
  const lines = [
    `Host skills sync (v${version || 'unknown'})${dryRun ? ' [dry-run]' : ''}`,
    `- copy: ${summary.copy}  current: ${summary.current}  skip: ${summary.skip}`
      + (summary.backup ? `  backup: ${summary.backup}` : '')
      + (summary.prune ? `  prune: ${summary.prune}` : '')
  ];
  if (results.packs) lines.push(`- packs: ${results.packs.join(', ')} (${results.packSource || 'default'})`);
  for (const item of results) {
    if (item.action === 'skip' && QUIET_SKIP_REASONS.has(item.reason)) continue;
    const rel = item.dest;
    if (item.action === 'copy') {
      lines.push(`  ${item.id.padEnd(12)} ${dryRun ? 'would-copy' : 'copied'}  ${rel}`);
      if (item.backup) {
        lines.push(`  ${''.padEnd(12)} ${dryRun ? 'would-backup' : 'backed-up'} ${item.backupPath || `${rel}.ael-backup`}`);
      }
    } else if (item.action === 'prune') lines.push(`  ${item.id.padEnd(12)} ${dryRun ? 'would-prune' : 'pruned'}  ${rel}`);
    else if (item.action === 'current') lines.push(`  ${item.id.padEnd(12)} current     ${rel}`);
    else lines.push(`  ${item.id.padEnd(12)} skip(${item.reason}) ${rel}`);
  }
  const notSelected = results.filter((item) => item.reason === 'pack-not-selected');
  if (notSelected.length) {
    const packs = [...new Set(notSelected.map((item) => item.pack))];
    lines.push(`Optional packs not installed: ${packs.join(', ')} (add with --pack ${packs.join(',')})`);
  }
  if (summary.copy > 0 && !dryRun) {
    lines.push('Skill text already loaded in this session stays stale until you start a new session.');
  }
  return lines.join('\n');
}

module.exports = {
  QUALITY_SKILLS,
  LOOP_REFERENCE_FILES,
  HOST_PACKS,
  DEFAULT_HOST_PACKS,
  normalizePacks,
  readHostManifest,
  hostSkillStatus,
  packageRoot,
  homeDir,
  EMIL_KOWALSKI_SKILLS,
  EMIL_KOWALSKI_SKILL_FILES,
  hostFileMap,
  planHostSync,
  applyHostSync,
  summarizeHostSync,
  formatHostSyncReport
};
