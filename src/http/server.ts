import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { availableViewports } from '../browser/viewports.js';
import type { Config } from '../config.js';
import { ERROR_CODES, ServiceError, toServiceError } from '../errors.js';
import { resolveClientIp } from '../guard/client-ip.js';
import type { RequestGuard } from '../guard/request-guard.js';
import type { Logger } from '../logger.js';
import { redactedError, redactUrl } from '../net/redact-url.js';
import { parseSnapshotRequest } from '../services/snapshot-request.js';
import type { Snapshotter } from '../services/snapshot-service.js';
import { sendError, sendImage, sendJson, sendText } from './responses.js';

const PLACEHOLDER_ORIGIN = 'http://websnapper.invalid';
const REQUEST_TIMEOUT_MS = 120_000;
const HEADERS_TIMEOUT_MS = 10_000;
const ROUTES = { health: '/health', viewports: '/v1/viewports', snapshot: '/v1/snapshot' } as const;

export interface ServerDependencies {
  config: Config;
  logger: Logger;
  guard: RequestGuard;
  snapshotter: Snapshotter;
  now?: () => number;
}

/**
 * Parses an origin-form request target (/path?query). Anything else (absolute-form, '*', or a
 * target the URL parser rejects) is null, so it never reaches routing or throws in the listener.
 */
export function parseRequestTarget(target: string | undefined): URL | null {
  const candidate = `${PLACEHOLDER_ORIGIN}${target ?? ''}`;
  return target?.startsWith('/') === true && URL.canParse(candidate) ? new URL(candidate) : null;
}

/** Returns an AbortSignal that fires if the client goes away before the response is sent. */
function clientGoneSignal(request: IncomingMessage, response: ServerResponse): AbortSignal {
  const controller = new AbortController();
  response.on('close', () => {
    if (!response.writableFinished) {
      controller.abort(new Error('The client closed the connection.'));
    }
  });
  request.on('error', (error) => controller.abort(error));
  return controller.signal;
}

/** Builds the request handler. Kept separate from listening so tests can use an ephemeral port. */
export function createRequestHandler(dependencies: ServerDependencies): (request: IncomingMessage, response: ServerResponse) => void {
  const { config, logger, guard, snapshotter } = dependencies;
  const now = dependencies.now ?? Date.now;

  /** Routes one request. Throws ServiceError for every failure. */
  const route = async (request: IncomingMessage, response: ServerResponse, url: URL | null, ip: string): Promise<void> => {
    guard.admit(ip, now());
    if (url === null) {
      throw new ServiceError('invalid_request', 'The request target must be a path, such as /v1/snapshot?url=….');
    }
    if (request.method !== 'GET') {
      throw new ServiceError('method_not_allowed', 'Only GET is supported.');
    }
    if (url.pathname === ROUTES.health) {
      sendText(response, snapshotter.isReady() ? 200 : ERROR_CODES.unavailable.status, snapshotter.isReady() ? 'ok\n' : 'starting\n');
    } else if (url.pathname === ROUTES.viewports) {
      guard.authenticate(request.headers.authorization, ip, now());
      sendJson(response, 200, { viewports: availableViewports(config.snapshot) });
    } else if (url.pathname === ROUTES.snapshot) {
      guard.authenticate(request.headers.authorization, ip, now());
      const snapshotRequest = parseSnapshotRequest(url.searchParams, config.snapshot);
      const result = await snapshotter.capture(snapshotRequest, clientGoneSignal(request, response));
      sendImage(response, result.image, result.contentType, {
        'X-Websnapper-Final-Url': encodeURI(result.finalUrl),
        'X-Websnapper-Upstream-Status': String(result.upstreamStatus),
        'X-Websnapper-Render-Ms': String(result.renderMs),
      });
    } else {
      throw new ServiceError('not_found', 'No such route.');
    }
  };

  return (request, response) => {
    const startedAt = now();
    const url = parseRequestTarget(request.url);
    const ip = resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for']?.toString(), config.trustedProxies);
    route(request, response, url, ip)
      .catch((error: unknown) => {
        const serviceError = toServiceError(error);
        if (serviceError.code === 'internal_error') {
          logger.error(`Unhandled error for ${request.method} ${url?.pathname ?? '(invalid target)'}`, { error: redactedError(error), ip });
        }
        if (response.headersSent || response.destroyed) {
          logger.debug(`Client ${ip} left before the response was sent.`, { error: serviceError.message });
        } else {
          const extraHeaders: Record<string, string> = serviceError.code === 'unauthorised' ? { 'WWW-Authenticate': 'Bearer' } : {};
          if (serviceError.code === 'method_not_allowed') {
            extraHeaders.Allow = 'GET';
          }
          sendError(response, serviceError, extraHeaders);
        }
        guard.recordFailure(ip, serviceError, now());
      })
      .finally(() => {
        const target = url?.searchParams.get('url') ?? null;
        const targetText = target !== null && URL.canParse(target) ? ` ${redactUrl(target)}` : '';
        logger.info(`${ip} ${request.method} ${url?.pathname ?? '(invalid target)'} ${response.statusCode} ${now() - startedAt}ms${targetText}`);
      })
      .catch((error: unknown) => {
        logger.error('Failed while finishing a response.', { error });
      });
  };
}

/** Creates the HTTP server with timeouts set; the caller listens. */
export function buildServer(dependencies: ServerDependencies): Server {
  const server = createServer(createRequestHandler(dependencies));
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
}
