#!/usr/bin/env node
'use strict';

const path = require('path');
const { auditPackage } = require('../lib/package-audit.js');

const result = auditPackage(path.join(__dirname, '..'));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result));
} else if (result.ok) {
  console.log(`Package privacy audit passed (${result.filesScanned} files scanned)`);
} else {
  console.error('Package privacy audit failed:');
  for (const finding of result.findings) {
    console.error(`- ${finding.file}: ${finding.reason}`);
  }
}
if (!result.ok) process.exit(1);
