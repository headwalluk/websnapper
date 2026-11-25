import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableViewports, VIEWPORT_PRESETS } from '../src/browser/viewports.js';
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

test('presets and implicit sizes stay inside lowered limits', () => {
  const limits = testConfig({ WEBSNAPPER_MAX_WIDTH_PX: '1400', WEBSNAPPER_MAX_HEIGHT_PX: '720' }).snapshot;
  const parseWith = (query: string): ReturnType<typeof parseSnapshotRequest> => parseSnapshotRequest(new URLSearchParams(query), limits);
  assert.throws(() => parseWith('url=https://example.com/'), (error: unknown) => error instanceof ServiceError && /"desktop" \(1920x1080\)/.test(error.message));
  assert.throws(() => parseWith('url=https://example.com/&viewport=laptop'), ServiceError);
  assert.equal(parseWith('url=https://example.com/&width=1280&full=1').viewport.height, 720);
  assert.equal(parseWith('url=https://example.com/&width=1280&height=720').viewport.width, 1280);
  assert.ok(availableViewports(limits).every((preset) => preset.width <= 1400 && preset.height <= 720));
  assert.ok(availableViewports(limits).length < availableViewports(LIMITS).length);
  assert.equal(availableViewports(LIMITS).length, VIEWPORT_PRESETS.size);
});
