import type { ServerResponse } from 'node:http';
import { ERROR_CODES, type ServiceError } from '../errors.js';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

/** Escapes text for safe inclusion in HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Sends a short HTML error page, never an image. Format: docs/api.md#errors */
export function sendError(response: ServerResponse, error: ServiceError, extraHeaders: Record<string, string> = {}): void {
  const { status, reason } = ERROR_CODES[error.code];
  const body = `<!doctype html>\n<title>${status} ${reason}</title>\n<h1>${status} ${reason}</h1>\n<p>${escapeHtml(error.message)}</p>\n`;
  const headers: Record<string, string> = {
    ...COMMON_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'",
    'X-Websnapper-Error': error.code,
    ...extraHeaders,
  };
  if (error.details.upstreamStatus !== undefined) {
    headers['X-Websnapper-Upstream-Status'] = String(error.details.upstreamStatus);
  }
  if (error.details.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(error.details.retryAfterSeconds);
  }
  response.writeHead(status, headers).end(body);
}

/** Sends a JSON body. */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...COMMON_HEADERS, 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/** Sends a plain-text body. */
export function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { ...COMMON_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
}

/** Sends an image with snapshot metadata headers. */
export function sendImage(response: ServerResponse, image: Uint8Array, contentType: string, headers: Record<string, string>): void {
  response.writeHead(200, { ...COMMON_HEADERS, 'Content-Type': contentType, 'Content-Length': String(image.byteLength), ...headers }).end(image);
}
