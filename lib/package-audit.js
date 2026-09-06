'use strict';

const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.yml', '.yaml', '.txt']);
const LOCAL_FILE_URL = new RegExp(`file:${'/'.repeat(3)}`, 'i');
const MAC_HOME = /\/Users\/(?!\.\.\.\/|<[^>]+>\/)[a-z0-9._-]+\//i;
const LINUX_HOME = /\/home\/(?!\.\.\.\/|<[^>]+>\/)[a-z0-9._-]+\//i;
const WINDOWS_HOME = /[a-z]:\\Users\\(?!\.\.\.\\|<[^>]+>\\)[^\\\r\n]+\\/i;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;

const PRIVACY_PATTERNS = Object.freeze([
  { label: 'local file URL', pattern: LOCAL_FILE_URL },
  { label: 'macOS user home', pattern: MAC_HOME },
  { label: 'Linux user home', pattern: LINUX_HOME },
  { label: 'Windows user home', pattern: WINDOWS_HOME },
  { label: 'private key material', pattern: PRIVATE_KEY }
]);

function walkFiles(rootDir, relativePath, files) {
  const absolute = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    files.add(relativePath.split(path.sep).join('/'));
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(absolute)) {
    walkFiles(rootDir, path.join(relativePath, entry), files);
  }
}

function listPackageFiles(rootDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const files = new Set(['package.json']);
  for (const entry of pkg.files || []) {
    walkFiles(rootDir, entry.replace(/\/$/, ''), files);
  }
  for (const entry of fs.readdirSync(rootDir)) {
    if (/^(?:readme|license|licence|security|support)(?:\.|$)/i.test(entry)) {
      walkFiles(rootDir, entry, files);
    }
  }
  return [...files].sort();
}

function auditText(content, relativePath) {
  const findings = [];
  for (const { label, pattern } of PRIVACY_PATTERNS) {
    if (pattern.test(content)) findings.push({ file: relativePath, reason: label });
  }
  return findings;
}

function auditPackage(rootDir) {
  const files = listPackageFiles(rootDir);
  const findings = [];
  for (const relativePath of files) {
    if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
    const content = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
    findings.push(...auditText(content, relativePath));
  }
  return {
    ok: findings.length === 0,
    filesScanned: files.length,
    findings
  };
}

module.exports = {
  PRIVACY_PATTERNS,
  listPackageFiles,
  auditText,
  auditPackage
};
