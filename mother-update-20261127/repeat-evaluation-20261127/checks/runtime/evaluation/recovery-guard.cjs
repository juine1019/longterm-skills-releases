'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const C = require('../context.cjs');

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function statIfPresent(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readOwner(file, leaseId, generation) {
  try {
    if (fs.lstatSync(file).isFile()) {
      const record = C.readJson(file);
      if (record?.schemaVersion === 1 && record.leaseId === leaseId &&
          record.generation === generation && Number.isSafeInteger(record.pid) && record.pid > 0 &&
          typeof record.host === 'string' && record.host.length > 0 &&
          typeof record.ownerId === 'string' && /^[a-f0-9]{32}$/.test(record.ownerId)) {
        return record;
      }
    }
  } catch {
    // A missing or unreadable ownership record cannot authorize a recovery.
  }
  fail('EVALUATION_RECOVERY_GUARD_INVALID');
}

function sameOwner(left, right) {
  return left.ownerId === right.ownerId && left.pid === right.pid && left.host === right.host;
}

function ownerExited(owner) {
  if (owner.host !== os.hostname()) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

function publish(dir, target, record) {
  const temporary = C.safeWithin(dir, 'pending-' + crypto.randomUUID() + '.tmp');
  C.writeNewJson(temporary, record);
  try {
    // A synced record becomes visible in one step. Never remove a predecessor
    // generation or rename over another process's ownership record.
    fs.linkSync(temporary, target);
  } finally {
    fs.unlinkSync(temporary);
  }
}

function acquireRecoveryGuard(context, leaseId) {
  if (typeof leaseId !== 'string' || leaseId.length === 0 || leaseId.length > 128) {
    fail('EVALUATION_RECOVERY_GUARD_INVALID');
  }
  for (const name of ['evaluation-recovery.lock', 'evaluation-collection-check.lock']) {
    if (statIfPresent(C.safeWithin(context.root, 'state', name))) {
      fail('EVALUATION_RECOVERY_LEGACY_LOCK');
    }
  }
  const key = crypto.createHash('sha256').update(leaseId).digest('hex');
  const dir = C.safeWithin(context.root, 'state', 'evaluation-recovery-guards', key);
  fs.mkdirSync(dir, { recursive: true });
  const entries = fs.readdirSync(dir);
  const generations = entries
    .map(name => /^owner-([1-9]\d*)\.json$/.exec(name))
    .filter(Boolean)
    .map(match => Number(match[1]))
    .sort((left, right) => left - right);
  if (generations.some((generation, index) => generation !== index + 1)) {
    fail('EVALUATION_RECOVERY_GUARD_INVALID');
  }
  if (entries.some(name => {
    const match = /^done-([1-9]\d*)\.json$/.exec(name);
    return match && Number(match[1]) > generations.length;
  })) {
    fail('EVALUATION_RECOVERY_GUARD_INVALID');
  }

  const prior = generations.length;
  if (prior) {
    const previousOwner = readOwner(C.safeWithin(dir, 'owner-' + prior + '.json'), leaseId, prior);
    const completionFile = C.safeWithin(dir, 'done-' + prior + '.json');
    if (statIfPresent(completionFile)) {
      if (!sameOwner(previousOwner, readOwner(completionFile, leaseId, prior))) {
        fail('EVALUATION_RECOVERY_GUARD_INVALID');
      }
    } else if (!ownerExited(previousOwner)) {
      fail('EVALUATION_RECOVERY_BUSY');
    }
  }

  const generation = prior + 1;
  const owner = {
    schemaVersion: 1,
    leaseId,
    generation,
    pid: process.pid,
    host: os.hostname(),
    ownerId: crypto.randomBytes(16).toString('hex'),
  };
  const ownerFile = C.safeWithin(dir, 'owner-' + generation + '.json');
  try {
    publish(dir, ownerFile, owner);
  } catch (error) {
    if (error.code === 'EEXIST') fail('EVALUATION_RECOVERY_BUSY');
    throw error;
  }

  let completed = false;
  return function release() {
    if (completed) return;
    if (!sameOwner(owner, readOwner(ownerFile, leaseId, generation))) {
      fail('EVALUATION_RECOVERY_GUARD_INVALID');
    }
    publish(dir, C.safeWithin(dir, 'done-' + generation + '.json'), owner);
    completed = true;
  };
}

module.exports = { acquireRecoveryGuard };
