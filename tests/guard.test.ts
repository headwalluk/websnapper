import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceError } from '../src/errors.js';
import { resolveClientIp } from '../src/guard/client-ip.js';
import { RateLimiter } from '../src/guard/rate-limiter.js';
import { bearerToken, RequestGuard } from '../src/guard/request-guard.js';
import { parseAddressList } from '../src/net/address-list.js';
import { addBan, findActiveBan } from '../src/services/ban-service.js';
import { createKey, listKeys, revokeKey } from '../src/services/key-service.js';
import { quietLogger, testConfig, testDatabase } from './helpers/fixtures.js';

const CLIENT = '198.51.100.7';
const START = 1_800_000_000_000;

test('the token bucket allows a burst, then refills over time', () => {
  const limiter = new RateLimiter({ perMinute: 60, burst: 3, banStrikes: 100, banWindowSeconds: 60 });
  assert.deepEqual([1, 2, 3].map(() => limiter.consume(CLIENT, START)), [0, 0, 0]);
  assert.equal(limiter.consume(CLIENT, START), 1);
  assert.equal(limiter.consume(CLIENT, START + 1000), 0);
});

test('strikes inside the window trigger a ban; old strikes expire', () => {
  const limiter = new RateLimiter({ perMinute: 60, burst: 10, banStrikes: 3, banWindowSeconds: 10 });
  assert.equal(limiter.strike(CLIENT, START), false);
  assert.equal(limiter.strike(CLIENT, START + 1000), false);
  assert.equal(limiter.strike(CLIENT, START + 20_000), false);
  assert.equal(limiter.strike(CLIENT, START + 21_000), false);
  assert.equal(limiter.strike(CLIENT, START + 22_000), true);
});

test('sweep forgets idle clients', () => {
  const limiter = new RateLimiter({ perMinute: 60, burst: 2, banStrikes: 3, banWindowSeconds: 10 });
  limiter.consume(CLIENT, START);
  assert.equal(limiter.sweep(START + 120_000), 1);
  assert.equal(limiter.size(), 0);
});

test('X-Forwarded-For is believed only from trusted proxies', () => {
  const proxies = parseAddressList(['192.0.2.10']).list;
  assert.equal(resolveClientIp('203.0.113.5', '198.51.100.1', proxies), '203.0.113.5');
  assert.equal(resolveClientIp('::ffff:192.0.2.10', '198.51.100.1', proxies), '198.51.100.1');
  assert.equal(resolveClientIp('192.0.2.10', '6.6.6.6, 198.51.100.1', proxies), '198.51.100.1');
  assert.equal(resolveClientIp('192.0.2.10', 'garbage', proxies), '192.0.2.10');
});

test('bearer tokens are read case-insensitively from the header', () => {
  assert.equal(bearerToken('Bearer wsk_abc'), 'wsk_abc');
  assert.equal(bearerToken('bearer   wsk_abc'), 'wsk_abc');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken(undefined), null);
});

test('token mode accepts active keys and refuses missing or revoked ones', () => {
  const { database, cleanUp } = testDatabase();
  try {
    const guard = new RequestGuard(testConfig(), database, quietLogger());
    const { key, token } = createKey(database, 'test', START);
    assert.doesNotThrow(() => guard.authenticate(`Bearer ${token}`, CLIENT, START));
    assert.equal(listKeys(database)[0]?.lastUsedAt, START);
    assert.throws(() => guard.authenticate(undefined, CLIENT, START), (error: unknown) => error instanceof ServiceError && error.code === 'unauthorised');
    revokeKey(database, key.id, START);
    assert.throws(() => guard.authenticate(`Bearer ${token}`, CLIENT, START), ServiceError);
  } finally {
    cleanUp();
  }
});

test('open mode needs no token', () => {
  const { database, cleanUp } = testDatabase();
  try {
    const guard = new RequestGuard(testConfig({ WEBSNAPPER_AUTH_MODE: 'open' }), database, quietLogger());
    assert.doesNotThrow(() => guard.authenticate(undefined, CLIENT, START));
  } finally {
    cleanUp();
  }
});

test('repeated failures ban the client in the database until the ban expires', () => {
  const { database, cleanUp } = testDatabase();
  try {
    const config = testConfig({ WEBSNAPPER_BAN_STRIKES: '3', WEBSNAPPER_BAN_DURATION_SECONDS: '60' });
    const guard = new RequestGuard(config, database, quietLogger());
    for (const offset of [0, 1, 2]) {
      guard.recordFailure(CLIENT, new ServiceError('not_found', 'No such route.'), START + offset);
    }
    assert.notEqual(findActiveBan(database, CLIENT, START + 10), null);
    assert.throws(() => guard.admit(CLIENT, START + 10), (error: unknown) => error instanceof ServiceError && error.details.retryAfterSeconds === 60);
    assert.doesNotThrow(() => guard.admit(CLIENT, START + 61_000));
  } finally {
    cleanUp();
  }
});

test('upstream failures and exempt addresses never earn strikes', () => {
  const { database, cleanUp } = testDatabase();
  try {
    const config = testConfig({ WEBSNAPPER_BAN_STRIKES: '1', WEBSNAPPER_RATE_LIMIT_EXEMPT: '192.0.2.0/24' });
    const guard = new RequestGuard(config, database, quietLogger());
    guard.recordFailure(CLIENT, new ServiceError('upstream_error', 'Target returned 500.'), START);
    guard.recordFailure('192.0.2.5', new ServiceError('unauthorised', 'No token.'), START);
    assert.equal(findActiveBan(database, CLIENT, START), null);
    assert.equal(findActiveBan(database, '192.0.2.5', START), null);
  } finally {
    cleanUp();
  }
});

/** Calls admit and returns the ServiceError it throws. */
function admitError(guard: RequestGuard, ip: string, now: number): ServiceError {
  let thrown: unknown = null;
  try {
    guard.admit(ip, now);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof ServiceError, 'admit should have refused the client');
  return thrown;
}

test('requests refused by a ban earn no strikes, so they cannot renew the ban', () => {
  const { database, cleanUp } = testDatabase();
  try {
    const config = testConfig({ WEBSNAPPER_BAN_STRIKES: '2', WEBSNAPPER_BAN_DURATION_SECONDS: '60' });
    const guard = new RequestGuard(config, database, quietLogger());
    guard.recordFailure(CLIENT, new ServiceError('not_found', 'x'), START);
    guard.recordFailure(CLIENT, new ServiceError('not_found', 'x'), START + 1);
    const expiresAt = findActiveBan(database, CLIENT, START + 2)?.expiresAt;
    for (const offset of [10, 20, 30, 40]) {
      const refusal = admitError(guard, CLIENT, START + offset);
      assert.equal(refusal.code, 'rate_limited');
      assert.equal(refusal.details.banned, true);
      guard.recordFailure(CLIENT, refusal, START + offset);
    }
    assert.equal(findActiveBan(database, CLIENT, START + 50)?.expiresAt, expiresAt);
  } finally {
    cleanUp();
  }
});

test('an automatic ban never shortens a longer manual ban', () => {
  const { database, cleanUp } = testDatabase();
  try {
    const config = testConfig({ WEBSNAPPER_BAN_STRIKES: '1', WEBSNAPPER_BAN_DURATION_SECONDS: '60' });
    const guard = new RequestGuard(config, database, quietLogger());
    const manual = addBan(database, CLIENT, 'Banned by the operator.', 86_400_000, START);
    // A strike recorded for an older, pre-ban request must leave the manual ban as it was.
    guard.recordFailure(CLIENT, new ServiceError('not_found', 'x'), START + 1);
    assert.deepEqual(findActiveBan(database, CLIENT, START + 2), manual);
  } finally {
    cleanUp();
  }
});
