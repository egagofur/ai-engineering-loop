'use strict';

// Append-only, hash-chained JSONL ledger inside a Run directory, shared by run
// interactions and run lifecycle. One writer at a time (a lock file next to
// the ledger), each event hashes its own material including the previous
// event's hash, and reads reject a ledger that was edited, reordered, or grew
// past its bound.

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./recipe.js');
const { assertRunId, loadRun, runsDir } = require('./run-state.js');

const LOCK_STALE_MS = 60_000;

function ledgerError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function materialHash(event) {
  const { hash, ...material } = event;
  return sha256(material);
}

// fileName: ledger file inside the Run directory. types: allowed event types.
// codes/messages: what callers see when the ledger is busy or invalid.
function createLedger({ fileName, maxBytes, types, codes, messages }) {
  function ledgerPath(rootDir, runId) {
    assertRunId(runId);
    loadRun(rootDir, runId);
    return path.join(runsDir(rootDir), runId, fileName);
  }

  function read(rootDir, runId) {
    const file = ledgerPath(rootDir, runId);
    if (!fs.existsSync(file)) return [];
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) {
      throw ledgerError(messages.bounded, codes.invalid);
    }
    const events = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    });
    let previousHash = null;
    for (const [index, event] of events.entries()) {
      if (!event || event.runId !== runId || event.sequence !== index + 1 ||
          event.previousHash !== previousHash || event.hash !== materialHash(event) ||
          !types.has(event.type)) {
        throw ledgerError(`${messages.event} ${index + 1} failed integrity validation`, codes.invalid);
      }
      previousHash = event.hash;
    }
    return events;
  }

  function withLock(rootDir, runId, operation) {
    const lock = `${ledgerPath(rootDir, runId)}.lock`;
    let descriptor;
    try {
      try {
        descriptor = fs.openSync(lock, 'wx', 0o600);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const stat = fs.lstatSync(lock);
        if (stat.isSymbolicLink() || !stat.isFile() || Date.now() - stat.mtimeMs <= LOCK_STALE_MS) {
          throw ledgerError(messages.busy, codes.busy);
        }
        fs.unlinkSync(lock);
        descriptor = fs.openSync(lock, 'wx', 0o600);
      }
      return operation();
    } finally {
      if (descriptor != null) {
        fs.closeSync(descriptor);
        try { fs.unlinkSync(lock); } catch {}
      }
    }
  }

  // Call inside withLock, with the events just read.
  function append(rootDir, runId, events, fields, now) {
    const material = {
      schemaVersion: 1,
      runId,
      sequence: events.length + 1,
      previousHash: events.at(-1)?.hash || null,
      at: now.toISOString(),
      ...fields
    };
    const event = { ...material, hash: sha256(material) };
    fs.appendFileSync(ledgerPath(rootDir, runId), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'a' });
    return event;
  }

  return { read, withLock, append };
}

module.exports = { createLedger };
