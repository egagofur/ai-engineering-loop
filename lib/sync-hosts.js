'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function packageRoot() {
  return path.join(__dirname, '..');
}

function homeDir(env = process.env) {
  if (env.AEL_HOME) return env.AEL_HOME;
  return os.homedir();
}

function applyGrokSkillOverlay(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return content;
  const yaml = match[1];
  if (/^user-invocable:\s*true\s*$/m.test(yaml)) return content;
  const nextYaml = `${yaml.replace(/\s*$/, '')}\nuser-invocable: true`;
  return `---\n${nextYaml}\n---\n${content.slice(match[0].length)}`;
}

function hostFileMap(home) {
  const claude = path.join(home, '.claude');
  const grok = path.join(home, '.grok');
  const gemini = path.join(home, '.gemini');
  const agents = path.join(home, '.agents');
  return [
    {
      id: 'claude',
      root: claude,
      files: [
        { src: '.claude/skills/ai-engineering-loop/SKILL.md', dest: path.join(claude, 'skills/ai-engineering-loop/SKILL.md'), mode: 'upsert' },
        { src: 'adapters/dot/skills/task-impact-inquiry/SKILL.md', dest: path.join(claude, 'skills/task-impact-inquiry/SKILL.md'), mode: 'upsert' },
        { src: 'adapters/generate-adapter/SKILL.md', dest: path.join(claude, 'skills/generate-adapter/SKILL.md'), mode: 'upsert' },
        { src: '.claude/agents/devil-advocate.md', dest: path.join(claude, 'agents/devil-advocate.md'), mode: 'upsert' },
        { src: '.claude/agents/judge.md', dest: path.join(claude, 'agents/judge.md'), mode: 'upsert' },
        { src: '.claude/commands/ai-engineering-loop.md', dest: path.join(claude, 'commands/ai-engineering-loop.md'), mode: 'upsert' }
      ]
    },
    {
      id: 'grok',
      root: grok,
      files: [
        { src: '.grok/skills/ai-engineering-loop/SKILL.md', dest: path.join(grok, 'skills/ai-engineering-loop/SKILL.md'), mode: 'upsert', grokSkillOverlay: true },
        { src: 'adapters/dot/skills/task-impact-inquiry/SKILL.md', dest: path.join(grok, 'skills/task-impact-inquiry/SKILL.md'), mode: 'upsert', grokSkillOverlay: true },
        { src: 'adapters/generate-adapter/SKILL.md', dest: path.join(grok, 'skills/generate-adapter/SKILL.md'), mode: 'upsert', grokSkillOverlay: true },
        { src: '.grok/agents/devil-advocate.md', dest: path.join(grok, 'agents/devil-advocate.md'), mode: 'upsert' },
        { src: '.grok/agents/judge.md', dest: path.join(grok, 'agents/judge.md'), mode: 'upsert' },
        { src: '.grok/commands/ai-engineering-loop.md', dest: path.join(grok, 'commands/ai-engineering-loop.md'), mode: 'upsert' }
      ]
    },
    {
      id: 'gemini',
      root: gemini,
      files: [
        { src: '.gemini/skills/ai-engineering-loop/SKILL.md', dest: path.join(gemini, 'config/skills/ai-engineering-loop/SKILL.md'), mode: 'upsert' },
        { src: 'adapters/dot/skills/task-impact-inquiry/SKILL.md', dest: path.join(gemini, 'config/skills/task-impact-inquiry/SKILL.md'), mode: 'upsert' },
        { src: 'adapters/generate-adapter/SKILL.md', dest: path.join(gemini, 'config/skills/generate-adapter/SKILL.md'), mode: 'upsert' }
      ]
    },
    {
      id: 'antigravity',
      root: agents,
      files: [
        { src: '.agents/devil-advocate.md', dest: path.join(agents, 'devil-advocate.md'), mode: 'upsert' },
        { src: '.agents/judge.md', dest: path.join(agents, 'judge.md'), mode: 'upsert' },
        { src: '.agents/workflows/ai-engineering-loop.md', dest: path.join(agents, 'workflows/ai-engineering-loop.md'), mode: 'upsert' }
      ]
    },
    {
      id: 'dot',
      root: null,
      files: [
        { src: 'adapters/dot/skills/dot-dev-skill-router/SKILL.md', dest: path.join(claude, 'skills/dot-dev-skill-router/SKILL.md'), mode: 'update-if-exists', hostRoot: claude },
        { src: 'adapters/dot/skills/dot-dev-workflow/SKILL.md', dest: path.join(claude, 'skills/dot-dev-workflow/SKILL.md'), mode: 'update-if-exists', hostRoot: claude },
        { src: 'adapters/dot/skills/dot-dev-skill-router/SKILL.md', dest: path.join(grok, 'skills/dot-dev-skill-router/SKILL.md'), mode: 'update-if-exists', hostRoot: grok, grokSkillOverlay: true },
        { src: 'adapters/dot/skills/dot-dev-workflow/SKILL.md', dest: path.join(grok, 'skills/dot-dev-workflow/SKILL.md'), mode: 'update-if-exists', hostRoot: grok, grokSkillOverlay: true },
        { src: 'adapters/dot/skills/dot-dev-skill-router/SKILL.md', dest: path.join(gemini, 'config/skills/dot-dev-skill-router/SKILL.md'), mode: 'update-if-exists', hostRoot: gemini },
        { src: 'adapters/dot/skills/dot-dev-workflow/SKILL.md', dest: path.join(gemini, 'config/skills/dot-dev-workflow/SKILL.md'), mode: 'update-if-exists', hostRoot: gemini }
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

function planHostSync({ packageRoot: root = packageRoot(), home = homeDir() } = {}) {
  const results = [];
  for (const group of hostFileMap(home)) {
    for (const file of group.files) {
      const srcAbs = path.join(root, file.src);
      const hostRoot = file.hostRoot || group.root;
      const item = {
        id: group.id,
        src: file.src,
        dest: file.dest,
        mode: file.mode
      };
      if (hostRoot && !fs.existsSync(hostRoot)) {
        results.push({ ...item, action: 'skip', reason: 'host-missing' });
        continue;
      }
      if (!fs.existsSync(srcAbs)) {
        results.push({ ...item, action: 'skip', reason: 'src-missing' });
        continue;
      }
      if (isSymlink(file.dest)) {
        results.push({ ...item, action: 'skip', reason: 'symlink' });
        continue;
      }
      if (file.mode === 'update-if-exists' && !destExists(file.dest)) {
        results.push({ ...item, action: 'skip', reason: 'not-installed' });
        continue;
      }
      let content = fs.readFileSync(srcAbs, 'utf8');
      if (file.grokSkillOverlay) content = applyGrokSkillOverlay(content);
      if (destExists(file.dest) && fs.readFileSync(file.dest, 'utf8') === content) {
        results.push({ ...item, action: 'current' });
        continue;
      }
      results.push({ ...item, action: 'copy', content });
    }
  }
  return results;
}

function applyHostSync({ packageRoot: root = packageRoot(), home = homeDir(), dryRun = false } = {}) {
  const plan = planHostSync({ packageRoot: root, home });
  const applied = [];
  for (const item of plan) {
    if (item.action !== 'copy') {
      applied.push(item);
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(item.dest), { recursive: true });
      fs.writeFileSync(item.dest, item.content);
    }
    applied.push({ ...item, content: undefined, dryRun });
  }
  return applied;
}

function summarizeHostSync(results) {
  const summary = { copy: 0, current: 0, skip: 0 };
  for (const item of results) {
    if (item.action === 'copy') summary.copy += 1;
    else if (item.action === 'current') summary.current += 1;
    else summary.skip += 1;
  }
  return summary;
}

function formatHostSyncReport(results, { version, dryRun = false } = {}) {
  const summary = summarizeHostSync(results);
  const lines = [
    `Host skills sync (v${version || 'unknown'})${dryRun ? ' [dry-run]' : ''}`,
    `- copy: ${summary.copy}  current: ${summary.current}  skip: ${summary.skip}`
  ];
  for (const item of results) {
    if (item.action === 'skip' && item.reason === 'host-missing') continue;
    if (item.action === 'skip' && item.reason === 'not-installed') continue;
    const rel = item.dest;
    if (item.action === 'copy') lines.push(`  ${item.id.padEnd(12)} ${dryRun ? 'would-copy' : 'copied'}  ${rel}`);
    else if (item.action === 'current') lines.push(`  ${item.id.padEnd(12)} current     ${rel}`);
    else lines.push(`  ${item.id.padEnd(12)} skip(${item.reason}) ${rel}`);
  }
  if (summary.copy > 0 && !dryRun) {
    lines.push('Skill text already loaded in this session stays stale until you start a new session.');
  }
  return lines.join('\n');
}

module.exports = {
  packageRoot,
  homeDir,
  applyGrokSkillOverlay,
  hostFileMap,
  planHostSync,
  applyHostSync,
  summarizeHostSync,
  formatHostSyncReport
};
