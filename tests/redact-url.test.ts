import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactedError, redactUrl, redactUrlsIn } from '../src/net/redact-url.js';

test('URLs lose their query strings in logs', () => {
  assert.equal(redactUrl('https://cdn.example/a.png?signature=secret'), 'https://cdn.example/a.png?…');
  assert.equal(redactUrl(new URL('https://example.com/path')), 'https://example.com/path');
  assert.equal(redactUrl('not a url'), '(unparseable URL)');
});

test('URLs inside error messages and stacks are redacted', () => {
  const message = 'net::ERR_FAILED at https://cdn.example/a.png?token=secret, then "http://other.example/?k=v"';
  assert.equal(redactUrlsIn(message), 'net::ERR_FAILED at https://cdn.example/a.png?… then "http://other.example/?…"');
  const redacted = redactedError(new Error(message));
  assert.doesNotMatch(`${redacted.message}${redacted.stack ?? ''}`, /secret|k=v/);
  assert.equal(redactedError('plain').message, 'plain');
});
