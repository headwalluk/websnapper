import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { BrowserHost } from '../src/browser/browser-host.js';
import { SnapshotPool } from '../src/browser/snapshot-pool.js';
import { ServiceError } from '../src/errors.js';
import { UrlPolicy } from '../src/guard/url-policy.js';
import { parseSnapshotRequest } from '../src/services/snapshot-request.js';
import { SnapshotService } from '../src/services/snapshot-service.js';
import { quietLogger, testConfig } from './helpers/fixtures.js';

const config = testConfig({ WEBSNAPPER_NAVIGATION_TIMEOUT_MS: '3000', WEBSNAPPER_MAX_FULL_HEIGHT_PX: '2500' });
const hasChromium = existsSync(config.browser.chromiumPath);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const TALL_PAGE_PX = 4000;

/** A local site: a page, a tall page, a 404, a redirect to a blocked path, and a page that never finishes. */
function startSite(): Server {
  return createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<h1>ok</h1><img src="/blocked/pixel.png">');
    } else if (request.url === '/tall') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<div style="height:${TALL_PAGE_PX}px">tall</div>`);
    } else if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/blocked/target' }).end();
    } else if (request.url === '/slow') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.write('<p>never finishes');
    } else {
      response.writeHead(404, { 'Content-Type': 'text/html' }).end('<h1>Not here</h1>');
    }
  });
}

/** Reads width and height from a PNG's IHDR chunk. */
function pngSize(image: Uint8Array): { width: number; height: number } {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('rendering with a real Chromium', { skip: hasChromium ? false : `no Chromium at ${config.browser.chromiumPath}` }, () => {
  const site = startSite();
  const host = new BrowserHost(config.browser, quietLogger());
  const blockPolicy = new UrlPolicy('block-list', 'all', () => [{ id: 1, pattern: '/blocked/', note: '', createdAt: 0 }], () => 1);
  const service = new SnapshotService(host, new SnapshotPool(2, 5, 10_000), blockPolicy, config, quietLogger());
  let siteUrl = '';

  before(async () => {
    site.listen(0, '127.0.0.1');
    await once(site, 'listening');
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
    await host.start();
  });

  after(async () => {
    await host.close();
    site.closeAllConnections();
    site.close();
  });

  /** Captures with the given query parameters appended to url=<site path>. */
  const capture = (path: string, query = ''): ReturnType<typeof service.capture> => (
    service.capture(parseSnapshotRequest(new URLSearchParams(`url=${encodeURIComponent(siteUrl + path)}${query}`), config.snapshot))
  );

  test('renders a PNG at the preset size, with blocked subresources dropped', async () => {
    const result = await capture('/', '&viewport=laptop');
    assert.deepEqual([...result.image.slice(0, 4)], PNG_SIGNATURE);
    assert.deepEqual(pngSize(result.image), { width: 1366, height: 768 });
    assert.equal(result.upstreamStatus, 200);
  });

  test('renders JPEG when asked', async () => {
    const result = await capture('/', '&format=jpeg&quality=50');
    assert.deepEqual([...result.image.slice(0, 3)], JPEG_SIGNATURE);
    assert.equal(result.contentType, 'image/jpeg');
  });

  test('full-page captures are clipped to the configured maximum height', async () => {
    const result = await capture('/tall', '&width=800&full=1');
    assert.deepEqual(pngSize(result.image), { width: 800, height: 2500 });
  });

  test('a target 404 fails as upstream_error with the status', async () => {
    await assert.rejects(capture('/missing'), (error: unknown) => (
      error instanceof ServiceError && error.code === 'upstream_error' && error.details.upstreamStatus === 404
    ));
  });

  test('a redirect into a blocked URL fails as url_blocked', async () => {
    await assert.rejects(capture('/redirect'), (error: unknown) => error instanceof ServiceError && error.code === 'url_blocked');
  });

  test('a blocked target is refused before Chromium is involved', async () => {
    await assert.rejects(capture('/blocked/page'), (error: unknown) => error instanceof ServiceError && error.code === 'url_blocked');
  });

  test('a page that never finishes loading times out', async () => {
    await assert.rejects(capture('/slow'), (error: unknown) => error instanceof ServiceError && error.code === 'upstream_timeout');
  });

  test('an unreachable host is an upstream_error', async () => {
    await assert.rejects(
      service.capture(parseSnapshotRequest(new URLSearchParams('url=http://does-not-exist.invalid/'), config.snapshot)),
      (error: unknown) => error instanceof ServiceError && error.code === 'upstream_error' && /ERR_NAME_NOT_RESOLVED/.test(error.message),
    );
  });
});
