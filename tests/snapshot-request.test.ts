import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ServiceError } from '../src/errors.js';
import { parseSnapshotRequest } from '../src/services/snapshot-request.js';
import { testConfig } from './helpers/fixtures.js';

const LIMITS = testConfig().snapshot;

/** Parses a query string with the default limits. */
function parse(query: string): ReturnType<typeof parseSnapshotRequest> {
  return parseSnapshotRequest(new URLSearchParams(query), LIMITS);
}

test('a bare URL gets the desktop preset and the default format', () => {
  const request = parse('url=https://example.com/');
  assert.equal(request.viewport.width, 1920);
  assert.equal(request.format, 'png');
  assert.equal(request.quality, undefined);
  assert.equal(request.fullPage, false);
});

test('device presets carry their user agent and scale', () => {
  const request = parse('url=https://example.com/&viewport=iphone-11');
  assert.equal(request.viewport.isMobile, true);
  assert.equal(request.viewport.deviceScaleFactor, 2);
  assert.match(request.viewport.userAgent ?? '', /iPhone/);
});

test('width with full=1 captures the full height; lossy formats get the default quality', () => {
  const request = parse('url=https://example.com/&width=1280&full=1&format=webp');
  assert.equal(request.viewport.width, 1280);
  assert.equal(request.fullPage, true);
  assert.equal(request.quality, 80);
});

test('every problem is reported together', () => {
  assert.throws(() => parse('url=ftp://example.com/&viewport=desktop&width=99999&format=gif&quality=0&wait=never&extra=1'), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, 'invalid_request');
    for (const fragment of ['Unknown parameter "extra"', 'http or https', 'not both', 'width must be', 'format must be', 'quality must be', 'wait must be']) {
      assert.ok(error.message.includes(fragment), `missing "${fragment}" in: ${error.message}`);
    }
    return true;
  });
});

test('quality with png, width without height, and repeated parameters are refused', () => {
  assert.throws(() => parse('url=https://example.com/&quality=50'), /quality applies to jpeg and webp only/);
  assert.throws(() => parse('url=https://example.com/&width=800'), /full=1/);
  assert.throws(() => parse('url=https://example.com/&url=https://example.org/'), /more than once/);
  assert.throws(() => parse(''), /url is required/);
});
