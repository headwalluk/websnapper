import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { ServiceError } from '../src/errors.js';
import { RequestGuard } from '../src/guard/request-guard.js';
import { buildServer } from '../src/http/server.js';
import { createKey } from '../src/services/key-service.js';
import type { SnapshotRequest } from '../src/services/snapshot-request.js';
import type { SnapshotResult, Snapshotter } from '../src/services/snapshot-service.js';
import { quietLogger, testConfig, testDatabase } from './helpers/fixtures.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** A snapshotter that fails for hosts named after error codes, and succeeds otherwise. */
class FakeSnapshotter implements Snapshotter {
  requests: SnapshotRequest[] = [];

  isReady(): boolean {
    return true;
  }

  async capture(request: SnapshotRequest): Promise<SnapshotResult> {
    this.requests.push(request);
    if (request.url.hostname === 'missing.example') {
      throw new ServiceError('upstream_error', 'Target returned 404 Not Found.', { upstreamStatus: 404 });
    }
    if (request.url.hostname === 'crash.example') {
      throw new Error('unexpected');
    }
    return { image: PNG_BYTES, contentType: 'image/png', finalUrl: request.url.href, upstreamStatus: 200, renderMs: 5 };
  }
}

const fixture = testDatabase();
const snapshotter = new FakeSnapshotter();
let server: Server;
let baseUrl = '';
let token = '';

before(async () => {
  const config = testConfig({ WEBSNAPPER_BAN_STRIKES: '50', WEBSNAPPER_RATE_LIMIT_BURST: '100', WEBSNAPPER_RATE_LIMIT_PER_MINUTE: '6000' });
  token = createKey(fixture.database, 'test', Date.now()).token;
  const guard = new RequestGuard(config, fixture.database, quietLogger());
  server = buildServer({ config, logger: quietLogger(), guard, snapshotter });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
  fixture.cleanUp();
});

/** Fetches a path with the test token. */
function get(path: string, withToken = true): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: withToken ? { Authorization: `Bearer ${token}` } : {} });
}

test('a snapshot comes back as an image with metadata headers', async () => {
  const response = await get('/v1/snapshot?url=https%3A%2F%2Fexample.com%2F&viewport=laptop');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-websnapper-upstream-status'), '200');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG_BYTES);
  assert.equal(snapshotter.requests.at(-1)?.viewport.width, 1366);
});

test('no token is a 401 HTML page with a WWW-Authenticate header', async () => {
  const response = await get('/v1/snapshot?url=https://example.com/', false);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  assert.equal(response.headers.get('x-websnapper-error'), 'unauthorised');
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(await response.text(), /<h1>401 Unauthorized<\/h1>/);
});

test('an upstream 404 is a 502 carrying the upstream status, never an image', async () => {
  const response = await get('/v1/snapshot?url=https://missing.example/');
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('x-websnapper-upstream-status'), '404');
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(await response.text(), /<h1>502 Bad Gateway<\/h1>\n<p>Target returned 404 Not Found.<\/p>/);
});

test('unexpected errors become a 500 without internals', async () => {
  const response = await get('/v1/snapshot?url=https://crash.example/');
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /unexpected/);
});

test('error messages are HTML-escaped', async () => {
  const response = await get('/v1/snapshot?url=https://example.com/&viewport=%3Cscript%3E');
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.doesNotMatch(body, /<script>/);
  assert.match(body, /&lt;script&gt;/);
});

test('health needs no token; unknown routes and methods are refused', async () => {
  assert.equal((await get('/health', false)).status, 200);
  assert.equal((await get('/nope')).status, 404);
  const posted = await fetch(`${baseUrl}/v1/snapshot`, { method: 'POST' });
  assert.equal(posted.status, 405);
  assert.equal(posted.headers.get('allow'), 'GET');
});

test('viewports are listed as JSON', async () => {
  const response = await get('/v1/viewports');
  const body = await response.json() as { viewports: { slug: string }[] };
  assert.ok(body.viewports.some((viewport) => viewport.slug === 'iphone-11'));
});

/** Sends a raw request line, which fetch would normalise, and returns the response status line. */
async function rawStatusLine(requestLine: string): Promise<string> {
  const port = (server.address() as AddressInfo).port;
  const socket = connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.end(`${requestLine}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  let received = '';
  socket.setEncoding('utf8');
  for await (const chunk of socket) {
    received += String(chunk);
  }
  return received.split('\r\n')[0] ?? '';
}

test('request targets the URL parser rejects get an error page instead of crashing the server', async () => {
  assert.equal(await rawStatusLine('GET // HTTP/1.1'), 'HTTP/1.1 404 Not Found');
  assert.equal(await rawStatusLine('GET //[ HTTP/1.1'), 'HTTP/1.1 404 Not Found');
  assert.equal(await rawStatusLine('GET http://[ HTTP/1.1'), 'HTTP/1.1 400 Bad Request');
  assert.equal(await rawStatusLine('GET http://example.com/health HTTP/1.1'), 'HTTP/1.1 400 Bad Request');
  assert.equal((await get('/health', false)).status, 200);
});
