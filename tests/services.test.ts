import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ServiceError } from '../src/errors.js';
import { runHousekeeping } from '../src/jobs/housekeeping.js';
import { addBan, findActiveBan, liftBan, listActiveBans } from '../src/services/ban-service.js';
import { countActiveKeys, createKey, findActiveKey, revokeKey } from '../src/services/key-service.js';
import { addRule, exportRules, importRules, listRules, removeRule } from '../src/services/rule-service.js';
import { dataVersion, numberColumn, openDatabase } from '../src/store/database.js';
import { applyMigrations, pendingMigrations } from '../src/store/migrations.js';
import { quietLogger, testDatabase } from './helpers/fixtures.js';

const NOW = 1_800_000_000_000;
const PRIVATE_NETWORKS_PATH = new URL('../config/private-networks.txt', import.meta.url);

test('a new database has pending migrations, and none once migrated', () => {
  const database = openDatabase(':memory:');
  try {
    assert.ok(pendingMigrations(database).length > 0);
    applyMigrations(database, NOW);
    assert.deepEqual(pendingMigrations(database), []);
    assert.deepEqual(applyMigrations(database, NOW), []);
  } finally {
    database.close();
  }
});

test('keys are stored hashed and the token works only until revoked', () => {
  const { database, cleanUp } = testDatabase();
  try {
    const { key, token } = createKey(database, 'dashboard', NOW);
    assert.match(token, /^wsk_[A-Za-z0-9_-]{43}$/);
    const stored = database.prepare('SELECT token_hash FROM api_keys').get();
    assert.notEqual(stored?.token_hash, token);
    assert.equal(findActiveKey(database, token)?.id, key.id);
    assert.equal(countActiveKeys(database), 1);
    assert.equal(revokeKey(database, key.id, NOW), true);
    assert.equal(revokeKey(database, key.id, NOW), false);
    assert.equal(findActiveKey(database, token), null);
    assert.throws(() => createKey(database, '   ', NOW), ServiceError);
  } finally {
    cleanUp();
  }
});

test('rules are validated before they are stored', () => {
  const { database, cleanUp } = testDatabase();
  try {
    assert.throws(() => addRule(database, '([unclosed', '', NOW), /Not a valid regular expression/);
    const rule = addRule(database, '^https?://10\\.', 'lan', NOW);
    assert.throws(() => addRule(database, '^https?://10\\.', '', NOW), /already rule/);
    assert.equal(listRules(database).length, 1);
    assert.equal(removeRule(database, rule.id), true);
    assert.equal(removeRule(database, rule.id), false);
  } finally {
    cleanUp();
  }
});

test('import keeps notes, skips duplicates, and round-trips through export', () => {
  const { database, cleanUp } = testDatabase();
  try {
    const first = importRules(database, '# Loopback\n^https?://127\\.\n\n^https?://10\\.\n', NOW);
    assert.equal(first.added.length, 2);
    assert.equal(first.added[0]?.note, 'Loopback');
    assert.equal(first.added[1]?.note, '');
    const second = importRules(database, exportRules(listRules(database)), NOW);
    assert.equal(second.added.length, 0);
    assert.equal(second.skipped.length, 2);
  } finally {
    cleanUp();
  }
});

test('an import with a bad line adds nothing', () => {
  const { database, cleanUp } = testDatabase();
  try {
    assert.throws(() => importRules(database, '^ok\n(bad\n', NOW), /Line 2/);
    assert.equal(listRules(database).length, 0);
  } finally {
    cleanUp();
  }
});

test('the shipped private-networks list imports cleanly', () => {
  const { database, cleanUp } = testDatabase();
  try {
    const { added } = importRules(database, readFileSync(PRIVATE_NETWORKS_PATH, 'utf8'), NOW);
    assert.ok(added.length >= 2);
  } finally {
    cleanUp();
  }
});

test('another connection committing changes the data version', () => {
  const { database, path, cleanUp } = testDatabase();
  const other = openDatabase(path);
  try {
    const before = dataVersion(database);
    addRule(other, '^x', '', NOW);
    assert.notEqual(dataVersion(database), before);
  } finally {
    other.close();
    cleanUp();
  }
});

test('bans lift themselves at expiry and can be lifted early', () => {
  const { database, cleanUp } = testDatabase();
  try {
    addBan(database, '::ffff:198.51.100.9', 'test', 60_000, NOW);
    assert.equal(findActiveBan(database, '198.51.100.9', NOW + 1)?.ip, '198.51.100.9');
    assert.equal(findActiveBan(database, '198.51.100.9', NOW + 60_000), null);
    addBan(database, '198.51.100.9', 'again', 60_000, NOW);
    assert.equal(listActiveBans(database, NOW).length, 1);
    assert.equal(liftBan(database, '198.51.100.9', NOW), true);
    assert.equal(liftBan(database, '198.51.100.9', NOW), false);
    assert.throws(() => addBan(database, 'not-an-ip', 'x', 1, NOW), ServiceError);
    addBan(database, '2001:DB8:0:0::1', 'expanded', 60_000, NOW);
    assert.equal(findActiveBan(database, '2001:db8::1', NOW + 1)?.reason, 'expanded');
    assert.equal(liftBan(database, '2001:db8:0::1', NOW + 1), true);
  } finally {
    cleanUp();
  }
});

test('housekeeping deletes expired bans and records its run', () => {
  const { database, cleanUp } = testDatabase();
  try {
    addBan(database, '198.51.100.1', 'old', 1000, NOW - 10_000);
    addBan(database, '198.51.100.2', 'current', 60_000, NOW);
    assert.deepEqual(runHousekeeping(database, quietLogger(), NOW), { expiredBans: 1, oldRuns: 0 });
    const run = database.prepare('SELECT result FROM housekeeping_runs').get();
    assert.equal(run?.result, 'ok');
    const remaining = database.prepare('SELECT COUNT(*) AS total FROM bans').get();
    assert.equal(remaining === undefined ? -1 : numberColumn(remaining, 'total'), 1);
  } finally {
    cleanUp();
  }
});

test('keep-later bans extend an existing ban but never shorten it', () => {
  const { database, cleanUp } = testDatabase();
  try {
    addBan(database, '198.51.100.9', 'long', 600_000, NOW);
    assert.equal(addBan(database, '198.51.100.9', 'short', 60_000, NOW + 1, 'keep-later').reason, 'long');
    assert.equal(addBan(database, '198.51.100.9', 'longer', 6_000_000, NOW + 2, 'keep-later').reason, 'longer');
    assert.equal(addBan(database, '198.51.100.9', 'operator', 1000, NOW + 3).reason, 'operator');
  } finally {
    cleanUp();
  }
});
