import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import { ConfigError, KNOWN_VARIABLES, loadConfig } from '../src/config.js';
import { normaliseAddress, parseAddressList } from '../src/net/address-list.js';

const SAMPLE_PATH = new URL('../.env.sample', import.meta.url);

test('an empty environment loads with safe defaults', () => {
  const config = loadConfig({}, '/srv/websnapper');
  assert.equal(config.authMode, 'token');
  assert.equal(config.listen.host, '127.0.0.1');
  assert.equal(config.urlPolicy.mode, 'open');
  assert.equal(config.snapshot.defaultFormat, 'png');
  assert.equal(config.databasePath, '/srv/websnapper/data/websnapper.sqlite');
  assert.equal(config.workerIndex, '0');
});

test('every problem is reported at once', () => {
  assert.throws(
    () => loadConfig({
      WEBSNAPPER_PORT: 'nope',
      WEBSNAPPER_AUTH_MODE: 'maybe',
      WEBSNAPPER_TRUSTED_PROXIES: '10.0.0.0/8, not-an-ip',
      WEBSNAPPER_IGNORE_TLS_ERRORS: 'sometimes',
      WEBSNAPPER_POOLSIZE: '3',
    }, '/srv'),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.problems.length, 5);
      assert.match(error.problems.join('\n'), /WEBSNAPPER_PORT must be a whole number/);
      assert.match(error.problems.join('\n'), /Unknown setting WEBSNAPPER_POOLSIZE/);
      return true;
    },
  );
});

test('auth stays gated unless open is chosen explicitly', () => {
  assert.equal(loadConfig({ WEBSNAPPER_AUTH_MODE: 'open' }, '/srv').authMode, 'open');
  assert.equal(loadConfig({ WEBSNAPPER_AUTH_MODE: '' }, '/srv').authMode, 'token');
});

test('address lists match addresses and ranges, including IPv4-mapped IPv6', () => {
  const config = loadConfig({ WEBSNAPPER_RATE_LIMIT_EXEMPT: '192.0.2.0/24, 2001:db8::1' }, '/srv');
  assert.equal(config.rateLimit.exempt.matches('192.0.2.77'), true);
  assert.equal(config.rateLimit.exempt.matches('::ffff:192.0.2.77'), true);
  assert.equal(config.rateLimit.exempt.matches('2001:db8::1'), true);
  assert.equal(config.rateLimit.exempt.matches('198.51.100.1'), false);
});

test('the sample config and the reader agree', () => {
  const sampleNames = Object.keys(parseEnv(readFileSync(SAMPLE_PATH, 'utf8')));
  const commentedNames = [...readFileSync(SAMPLE_PATH, 'utf8').matchAll(/^#\s*(WEBSNAPPER_[A-Z_]+)=/gm)].map((match) => match[1]);
  const documented = new Set([...sampleNames, ...commentedNames]);
  for (const name of KNOWN_VARIABLES) {
    assert.ok(documented.has(name), `${name} is missing from .env.sample`);
  }
  for (const name of documented) {
    assert.ok(name !== undefined && KNOWN_VARIABLES.has(name), `${name} in .env.sample is not read by config.ts`);
  }
  assert.doesNotThrow(() => loadConfig(parseEnv(readFileSync(SAMPLE_PATH, 'utf8')), '/srv'));
});

test('a CIDR prefix must be digits, so an empty one cannot become /0', () => {
  for (const entry of ['10.0.0.0/', '10.0.0.0/ ', '10.0.0.0/x', '10.0.0.0/+8', '10.0.0.0/8.0', '2001:db8::/']) {
    assert.deepEqual(parseAddressList([entry]).invalidEntries, [entry], entry);
  }
  assert.throws(() => loadConfig({ WEBSNAPPER_TRUSTED_PROXIES: '10.0.0.0/' }, '/srv'), ConfigError);
  assert.deepEqual(parseAddressList(['10.0.0.0/8', '0.0.0.0/0', '2001:db8::/32']).invalidEntries, []);
  assert.equal(parseAddressList(['10.0.0.0/8']).list.matches('203.0.113.1'), false);
});

test('addresses are normalised to one spelling', () => {
  assert.equal(normaliseAddress('2001:DB8:0:0::0001'), '2001:db8::1');
  assert.equal(normaliseAddress('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(normaliseAddress('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(normaliseAddress('::ffff:c000:201'), '192.0.2.1');
  assert.equal(normaliseAddress(' 192.0.2.1 '), '192.0.2.1');
  assert.equal(normaliseAddress('fe80::1%eth0'), 'fe80::1%eth0');
  assert.equal(normaliseAddress('not-an-ip'), 'not-an-ip');
});
