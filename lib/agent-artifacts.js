'use strict';

const fs = require('fs');
const path = require('path');
const { validateFindingLedger } = require('./orchestration.js');
const { validateVerificationBundle } = require('./gates.js');
const {
  getCurrentRun,
  getGitRevision,
  loadRun,
  runsDir
} = require('./run-state.js');

const ARTIFACT_TYPES = Object.freeze({
  verification: 'verification',
  findings: 'findings',
  delivery: 'delivery'
});

function artifactError(message, code = 'ARTIFACT_TOOL_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveRun(rootDir, runId) {
  if (runId) return loadRun(rootDir, runId);
  const current = getCurrentRun(rootDir);
  if (!current) throw artifactError('No current Run. Pass --run <id>.', 'NO_CURRENT_RUN');
  return current;
}

function assertNoSymlinkPath(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw artifactError('Artifact path must stay inside the repository.', 'UNSAFE_ARTIFACT_PATH');
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw artifactError(`Artifact path crosses a symlink: ${path.relative(root, current)}`, 'UNSAFE_ARTIFACT_PATH');
      }
    } catch (cause) {
      if (cause.code === 'ENOENT') return;
      throw cause;
    }
  }
}

function templateFor(type, run, rootDir) {
  const common = {
    schemaVersion: 1,
    runId: run.runId,
    _templateOnly: true,
    _instructions: 'Template only. Replace placeholders with observed evidence before validation or gating.'
  };
  const diffHash = run.artifacts?.diff?.sha256 || '__FILL_AFTER_GATE_MAKER__';

  if (type === 'verification') {
    return {
      ...common,
      gitRevision: getGitRevision(rootDir),
      diffHash,
      commands: [{
        command: '__FILL_WITH_COMMAND__',
        executionIdentity: '__FILL_WITH_PROCESS_OR_AGENT_ID__',
        startTime: '__FILL_WITH_ISO_TIMESTAMP__',
        endTime: '__FILL_WITH_ISO_TIMESTAMP__',
        exitCode: null,
        stdout: '',
        timeoutStatus: 'NOT_RUN'
      }]
    };
  }
  if (type === 'findings') {
    return {
      ...common,
      diffHash,
      findings: [{
        id: '',
        axis: 'spec',
        location: '',
        failureScenario: '',
        evidence: '',
        severity: '',
        validity: '',
        disposition: ''
      }]
    };
  }
  if (type === 'delivery') {
    return {
      ...common,
      destination: '',
      summary: '',
      humanApproved: false
    };
  }
  throw artifactError(`Unknown artifact type '${type}'. Use ${Object.keys(ARTIFACT_TYPES).join('|')}.`, 'UNKNOWN_ARTIFACT_TYPE');
}

function scaffoldArtifact(rootDir, { type, runId } = {}) {
  if (!Object.hasOwn(ARTIFACT_TYPES, type)) {
    throw artifactError(`Unknown artifact type '${type || ''}'. Use ${Object.keys(ARTIFACT_TYPES).join('|')}.`, 'UNKNOWN_ARTIFACT_TYPE');
  }
  const run = resolveRun(rootDir, runId);
  const filePath = path.join(runsDir(rootDir), run.runId, `${type}.template.json`);
  const directory = path.dirname(filePath);
  const repositoryPath = path.resolve(rootDir);
  const realRoot = fs.realpathSync(rootDir);
  assertNoSymlinkPath(repositoryPath, directory);
  const realDirectory = fs.realpathSync(directory);
  if (!realDirectory.startsWith(`${realRoot}${path.sep}`)) {
    throw artifactError('Artifact template path escapes the repository.', 'UNSAFE_ARTIFACT_PATH');
  }
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'wx', 0o600);
  } catch (cause) {
    if (cause.code === 'EEXIST') {
      throw artifactError(`Template already exists: ${path.relative(rootDir, filePath)}. It was left unchanged.`, 'ARTIFACT_EXISTS');
    }
    throw cause;
  }
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(templateFor(type, run, rootDir), null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return {
    type,
    runId: run.runId,
    path: path.relative(rootDir, filePath).split(path.sep).join('/')
  };
}

function resolveArtifactFile(rootDir, requestedPath) {
  if (!requestedPath || path.isAbsolute(requestedPath)) {
    throw artifactError('Artifact path must be repository-relative.', 'UNSAFE_ARTIFACT_PATH');
  }
  const root = fs.realpathSync(rootDir);
  const absolute = path.resolve(root, requestedPath);
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw artifactError('Artifact path must stay inside the repository.', 'UNSAFE_ARTIFACT_PATH');
  }
  assertNoSymlinkPath(root, absolute);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw artifactError('Artifact must be a regular file, not a symlink.', 'UNSAFE_ARTIFACT_PATH');
  }
  const realFile = fs.realpathSync(absolute);
  if (!realFile.startsWith(`${root}${path.sep}`)) {
    throw artifactError('Artifact path escapes the repository through a symlink.', 'UNSAFE_ARTIFACT_PATH');
  }
  return absolute;
}

function inferArtifactType(file, explicitType) {
  if (explicitType && Object.hasOwn(ARTIFACT_TYPES, explicitType)) return explicitType;
  const base = path.basename(file).replace(/\.template(?=\.json$)/, '');
  const inferred = base.endsWith('.json') ? base.slice(0, -'.json'.length) : base;
  if (Object.hasOwn(ARTIFACT_TYPES, inferred)) return inferred;
  throw artifactError(
    `Unable to infer artifact type from '${path.basename(file)}'. Pass --type ${Object.keys(ARTIFACT_TYPES).join('|')}.`,
    'UNKNOWN_ARTIFACT_TYPE'
  );
}

function metadataErrors(document, run) {
  const errors = [];
  if (document.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (document.runId !== run.runId) errors.push(`runId must be ${run.runId}`);
  return errors;
}

function validateDelivery(document, run) {
  const errors = metadataErrors(document, run);
  if (!String(document.destination || '').trim()) errors.push('destination is required');
  if (!String(document.summary || '').trim()) errors.push('summary is required');
  if (run.mode === 'ASSISTED' && document.humanApproved !== true) {
    errors.push('humanApproved must be true for ASSISTED delivery');
  }
  return errors;
}

function validateArtifactDocument(type, document, run, rootDir) {
  if (document?._templateOnly === true) {
    return ['This is a scaffold, not evidence. Fill it with observed facts and remove _templateOnly before validation.'];
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return ['Artifact must be a JSON object.'];
  }
  if (type === 'verification') {
    const diffHash = run.artifacts?.diff?.sha256;
    if (!diffHash) return ['Maker diff has not passed its gate yet.'];
    try {
      const result = validateVerificationBundle(document, run, diffHash, getGitRevision(rootDir));
      return result.errors;
    } catch (cause) {
      return [cause.message];
    }
  }
  if (type === 'findings') {
    const errors = metadataErrors(document, run);
    if (!run.artifacts?.diff?.sha256) errors.push('Maker diff has not passed its gate yet.');
    if (document.diffHash !== run.artifacts?.diff?.sha256) errors.push('diffHash does not match the gated Maker diff.');
    const result = validateFindingLedger(document);
    if (!result.valid) errors.push(result.reason);
    return errors;
  }
  return validateDelivery(document, run);
}

function validateArtifactFile(rootDir, { file, type } = {}) {
  const filePath = resolveArtifactFile(rootDir, file);
  const inferredType = inferArtifactType(file, type);
  let document;
  try {
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (cause) {
    return {
      valid: false,
      type: inferredType,
      path: path.relative(rootDir, filePath).split(path.sep).join('/'),
      errors: [`Invalid JSON: ${cause.message}`]
    };
  }
  const run = resolveRun(rootDir, document?.runId);
  const errors = validateArtifactDocument(inferredType, document, run, rootDir);
  return {
    valid: errors.length === 0,
    type: inferredType,
    runId: run.runId,
    path: path.relative(rootDir, filePath).split(path.sep).join('/'),
    errors,
    note: 'Validation checks artifact content only; the owning gate still enforces stage readiness, freshness, and explicit approvals.'
  };
}

module.exports = {
  ARTIFACT_TYPES,
  scaffoldArtifact,
  validateArtifactFile
};
