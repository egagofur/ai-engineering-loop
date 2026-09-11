'use strict';

const fs = require('fs');
const path = require('path');
const { validateGoalContract, hashFile } = require('./gates.js');
const { sha256 } = require('./recipe.js');
const {
  RUN_STATES,
  atomicWritePrivateFile,
  atomicWriteJson,
  loadRun,
  runsDir,
  transitionRun
} = require('./run-state.js');

function goalError(message, code, details = []) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function actorId(actor) {
  const value = String(actor || '').trim();
  if (!/^[A-Za-z0-9@._-]{1,64}$/.test(value)) {
    throw goalError('Goal actor must be a short account identifier', 'INVALID_GOAL_ACTOR');
  }
  return value;
}

function goalPaths(rootDir, runId, version) {
  const directory = path.join(runsDir(rootDir), runId);
  return {
    draft: path.join(directory, 'goal-draft.json'),
    canonical: path.join(directory, 'goal-contract.json'),
    version: path.join(directory, `goal-contract.v${version}.json`)
  };
}

function readDraftFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > 256 * 1024) {
    throw goalError('Goal draft must be a bounded regular file', 'INVALID_GOAL_DRAFT');
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    throw goalError(`Goal draft is invalid: ${cause.message}`, 'INVALID_GOAL_DRAFT');
  }
}

function normalizeDraft(value, runId) {
  if (value?.contract && value?.metadata) {
    const { contract, metadata } = value;
    const revision = Number(metadata.revision);
    const contentHash = sha256(contract);
    if (
      contract.runId !== runId ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      !/^[A-Za-z0-9@._-]{1,64}$/.test(String(metadata.actor || '')) ||
      !metadata.updatedAt ||
      !Number.isFinite(Date.parse(metadata.updatedAt)) ||
      metadata.contentHash !== contentHash
    ) {
      throw goalError('Goal draft envelope failed integrity validation', 'INVALID_GOAL_DRAFT');
    }
    return value;
  }
  if (value?.objective) {
    const contract = { ...value, schemaVersion: 1, runId };
    return {
      contract,
      metadata: {
        revision: 0,
        actor: 'legacy',
        updatedAt: null,
        contentHash: sha256(contract)
      }
    };
  }
  throw goalError('Goal draft envelope is invalid', 'INVALID_GOAL_DRAFT');
}

function loadGoalDraft(rootDir, runId) {
  const run = loadRun(rootDir, runId);
  const value = readDraftFile(goalPaths(rootDir, runId, run.goal?.version || 1).draft);
  return value ? normalizeDraft(value, runId) : null;
}

function markdownCell(value) {
  return String(value || '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function writeGoalMirror(rootDir, envelope) {
  const { contract, metadata } = envelope;
  const rows = (contract.acceptanceCriteria || []).map((criterion) => (
    `| ${markdownCell(criterion.id)} | ${markdownCell(criterion.statement)} | ` +
    `${markdownCell(criterion.evidenceRequired)} | ${markdownCell((criterion.failureCases || []).join('; '))} |`
  ));
  const markdown = [
    '# Goal Contract Draft',
    '',
    `**Run:** \`${contract.runId}\`  `,
    `**Revision:** ${metadata.revision}  `,
    `**Status:** DRAFT — not frozen  `,
    `**Content hash:** \`${metadata.contentHash}\``,
    '',
    '## Objective',
    '',
    contract.objective,
    '',
    '## Acceptance criteria and failure table',
    '',
    '| AC | Required behavior | Evidence seam | Failure cases |',
    '|---|---|---|---|',
    ...rows,
    ''
  ].join('\n');
  atomicWritePrivateFile(
    path.join(rootDir, '.ai-engineering-loop', 'tasks', 'goal-contract.md'),
    markdown
  );
}

function saveGoalDraft(
  rootDir,
  runId,
  contract,
  { actor = 'studio-user', expectedRevision, now = new Date() } = {}
) {
  const run = loadRun(rootDir, runId);
  if (run.goal?.frozen) throw goalError('Frozen Goal must be unfrozen before editing', 'GOAL_IS_FROZEN');
  if (contract?.runId && contract.runId !== runId) {
    throw goalError('Goal draft belongs to another Run', 'GOAL_RUN_MISMATCH');
  }
  const human = actorId(actor);
  const current = loadGoalDraft(rootDir, runId);
  const currentRevision = current?.metadata.revision || 0;
  if (expectedRevision != null && Number(expectedRevision) !== currentRevision) {
    throw goalError(
      `Goal draft changed from revision ${expectedRevision} to ${currentRevision}`,
      'GOAL_DRAFT_CONFLICT'
    );
  }
  const normalized = { ...contract, schemaVersion: 1, runId };
  const validation = validateGoalContract(normalized);
  if (!validation.valid) throw goalError('Goal Contract draft is invalid', 'GATE_FAILED', validation.errors);
  const envelope = {
    contract: normalized,
    metadata: {
      revision: currentRevision + 1,
      actor: human,
      updatedAt: now.toISOString(),
      contentHash: sha256(normalized)
    }
  };
  atomicWriteJson(goalPaths(rootDir, runId, run.goal?.version || 1).draft, envelope);
  writeGoalMirror(rootDir, envelope);
  return envelope;
}

function freezeGoal(
  rootDir,
  runId,
  { actor, expectedRevision, expectedHash, now = new Date() } = {}
) {
  const run = loadRun(rootDir, runId);
  if (run.state !== RUN_STATES.STARTED || run.goal?.frozen) {
    throw goalError(`Run ${runId} cannot freeze a Goal from ${run.state}`, 'INVALID_GOAL_TRANSITION');
  }
  const version = run.goal?.version || 1;
  const paths = goalPaths(rootDir, runId, version);
  const draft = loadGoalDraft(rootDir, runId);
  if (!draft) throw goalError('Goal draft is unavailable', 'GOAL_DRAFT_MISSING');
  const { contract, metadata } = draft;
  if ((expectedRevision != null && Number(expectedRevision) !== metadata.revision) ||
      (expectedHash != null && String(expectedHash) !== metadata.contentHash)) {
    throw goalError('Goal draft changed after review', 'GOAL_DRAFT_CONFLICT');
  }
  const validation = validateGoalContract(contract);
  if (!validation.valid) throw goalError('Goal Contract gate failed', 'GATE_FAILED', validation.errors);
  const human = actorId(actor);
  if (fs.existsSync(paths.version)) {
    throw goalError(`Goal version ${version} already exists`, 'GOAL_VERSION_EXISTS');
  }
  atomicWriteJson(paths.version, contract);
  atomicWriteJson(paths.canonical, contract);
  const artifactHash = hashFile(paths.version);
  const contentHash = sha256(contract);
  if (contentHash !== metadata.contentHash) {
    throw goalError('Goal draft hash does not match its reviewed content', 'GOAL_DRAFT_HASH_MISMATCH');
  }
  const transitionOptions = {
    artifacts: {
      goalContract: {
        path: path.relative(rootDir, paths.version).split(path.sep).join('/'),
        sha256: artifactHash,
        goalVersion: version
      }
    },
    statePatch: {
      goal: {
        version,
        frozen: true,
        hash: contentHash,
        draftRevision: metadata.revision,
        actor: human,
        frozenAt: now.toISOString()
      }
    },
    historyMetadata: { actor: human, goalVersion: version, goalHash: contentHash },
    now
  };
  if (run.workflow) {
    const { applyWorkflowGate } = require('./workflow-runtime.js');
    return applyWorkflowGate(rootDir, 'goal', { runId, now, transitionOptions }).run;
  }
  return transitionRun(rootDir, runId, RUN_STATES.GOAL_FROZEN, {
    gate: 'goal',
    ...transitionOptions
  });
}

function unfreezeGoal(rootDir, runId, { actor, reason, now = new Date() } = {}) {
  const run = loadRun(rootDir, runId);
  if (run.state !== RUN_STATES.GOAL_FROZEN || !run.goal?.frozen) {
    throw goalError(`Run ${runId} has no frozen editable Goal`, 'INVALID_GOAL_TRANSITION');
  }
  const why = String(reason || '').trim();
  if (!why || why.length > 500) {
    throw goalError('Unfreeze reason must be 1-500 characters', 'INVALID_UNFREEZE_REASON');
  }
  const human = actorId(actor);
  const transitionOptions = {
    reason: why,
    statePatch: {
      goal: {
        version: run.goal.version + 1,
        frozen: false,
        previousVersion: run.goal.version,
        unfrozenBy: human,
        unfrozenAt: now.toISOString()
      }
    },
    historyMetadata: {
      actor: human,
      goalVersion: run.goal.version,
      nextGoalVersion: run.goal.version + 1
    },
    now
  };
  if (run.workflow) {
    const { unfreezeWorkflowGoal } = require('./workflow-runtime.js');
    return unfreezeWorkflowGoal(rootDir, { runId, transitionOptions, now }).run;
  }
  return transitionRun(rootDir, runId, RUN_STATES.STARTED, {
    gate: 'goal-unfreeze',
    ...transitionOptions
  });
}

module.exports = { saveGoalDraft, loadGoalDraft, freezeGoal, unfreezeGoal };
