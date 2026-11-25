import { STATUS_CODES } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BrowserContext, HTTPRequest, HTTPResponse, Page } from 'puppeteer-core';
import type { BrowserHost } from '../browser/browser-host.js';
import type { SnapshotPool } from '../browser/snapshot-pool.js';
import type { Config, ImageFormat } from '../config.js';
import { ServiceError } from '../errors.js';
import type { UrlPolicy } from '../guard/url-policy.js';
import type { Logger } from '../logger.js';
import { redactedError, redactUrl } from '../net/redact-url.js';
import type { SnapshotRequest } from './snapshot-request.js';

export const CONTENT_TYPES: Record<ImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const FIRST_ERROR_STATUS = 400;
const PUPPETEER_WAIT_EVENTS = { load: 'load', networkidle: 'networkidle2' } as const;
const NET_ERROR_PATTERN = /net::ERR_[A-Z_]+/;

export interface SnapshotResult {
  image: Uint8Array;
  contentType: string;
  finalUrl: string;
  upstreamStatus: number;
  renderMs: number;
}

/** Anything that can turn a SnapshotRequest into an image; the HTTP layer depends only on this. */
export interface Snapshotter {
  capture(request: SnapshotRequest, signal?: AbortSignal): Promise<SnapshotResult>;
  isReady(): boolean;
}

/** Tracks navigations the policy blocked, so a failed goto can be reported as url_blocked. */
interface BlockedNavigation {
  url: string;
  reason: string;
}

/** Renders snapshots through the pool and browser host, enforcing the URL policy on every request. */
export class SnapshotService implements Snapshotter {
  private readonly host: BrowserHost;
  private readonly pool: SnapshotPool;
  private readonly policy: UrlPolicy;
  private readonly browserSettings: Config['browser'];
  private readonly maxFullHeightPx: number;
  private readonly logger: Logger;

  constructor(host: BrowserHost, pool: SnapshotPool, policy: UrlPolicy, config: Config, logger: Logger) {
    this.host = host;
    this.pool = pool;
    this.policy = policy;
    this.browserSettings = config.browser;
    this.maxFullHeightPx = config.snapshot.maxFullHeightPx;
    this.logger = logger;
  }

  /** Whether the browser is up. */
  isReady(): boolean {
    return this.host.isReady();
  }

  /** Checks the target URL against the policy, then renders it in a pool slot. */
  async capture(request: SnapshotRequest, signal?: AbortSignal): Promise<SnapshotResult> {
    this.policy.refresh();
    const verdict = this.policy.evaluate(request.url.href, true);
    if (!verdict.allowed) {
      throw new ServiceError('url_blocked', verdict.reason);
    }
    const startedAt = performance.now();
    const rendered = await this.pool.run(() => this.host.withContext((context) => this.render(context, request, signal)), signal);
    return { ...rendered, renderMs: Math.round(performance.now() - startedAt) };
  }

  /** Installs request interception that applies the URL policy to redirects, frames and subresources. */
  private async enforcePolicy(page: Page, blocked: BlockedNavigation[]): Promise<void> {
    if (this.policy.mode === 'open') {
      return;
    }
    await page.setRequestInterception(true);
    page.on('request', (intercepted: HTTPRequest) => {
      if (intercepted.isInterceptResolutionHandled()) {
        return;
      }
      const isNavigation = intercepted.isNavigationRequest();
      const verdict = isNavigation || this.policy.checksSubresources()
        ? this.policy.evaluate(intercepted.url(), isNavigation)
        : null;
      const resolution = verdict === null || verdict.allowed ? intercepted.continue() : intercepted.abort('blockedbyclient');
      if (verdict !== null && !verdict.allowed) {
        this.logger.debug(`Blocked ${isNavigation ? 'navigation' : 'request'} to ${redactUrl(intercepted.url())}`, { reason: verdict.reason });
        if (isNavigation && intercepted.frame() === page.mainFrame()) {
          blocked.push({ url: intercepted.url(), reason: verdict.reason });
        }
      }
      resolution.catch((error: unknown) => {
        this.logger.debug('Could not resolve an intercepted request; the page was probably closed.', { error: redactedError(error) });
      });
    });
  }

  /** Loads the page, turning navigation failures into service errors. */
  private async navigate(page: Page, request: SnapshotRequest, blocked: BlockedNavigation[]): Promise<HTTPResponse> {
    let response: HTTPResponse | null;
    try {
      response = await page.goto(request.url.href, {
        waitUntil: PUPPETEER_WAIT_EVENTS[request.wait],
        timeout: this.browserSettings.navigationTimeoutMs,
      });
    } catch (error) {
      throw this.navigationError(error, blocked);
    }
    const firstBlocked = blocked[0];
    if (firstBlocked !== undefined) {
      throw new ServiceError('url_blocked', `Redirected to a blocked URL. ${firstBlocked.reason}`);
    }
    if (response === null) {
      throw new ServiceError('upstream_error', 'The target sent no response.');
    }
    if (response.status() >= FIRST_ERROR_STATUS) {
      // HTTP/2 responses carry no reason phrase, so fall back to the standard one.
      const statusText = response.statusText() || (STATUS_CODES[response.status()] ?? '');
      throw new ServiceError('upstream_error', `Target returned ${response.status()}${statusText === '' ? '' : ` ${statusText}`}.`, {
        upstreamStatus: response.status(),
      });
    }
    return response;
  }

  /** Maps a page.goto failure to the matching service error. */
  private navigationError(error: unknown, blocked: BlockedNavigation[]): ServiceError {
    const message = error instanceof Error ? error.message : String(error);
    const netError = NET_ERROR_PATTERN.exec(message)?.[0];
    const firstBlocked = blocked[0];
    let mapped: ServiceError;
    if (firstBlocked !== undefined) {
      mapped = new ServiceError('url_blocked', `Redirected to a blocked URL. ${firstBlocked.reason}`);
    } else if (error instanceof Error && error.name === 'TimeoutError') {
      mapped = new ServiceError('upstream_timeout', `The target did not finish loading within ${this.browserSettings.navigationTimeoutMs} ms.`);
    } else if (netError !== undefined) {
      mapped = new ServiceError('upstream_error', `Could not load the target: ${netError}.`);
    } else {
      this.logger.warn('Navigation failed unexpectedly.', { error: redactedError(error) });
      mapped = new ServiceError('upstream_error', 'Could not load the target.');
    }
    return mapped;
  }

  /** Captures the viewport, or the full rendered height clipped to the configured maximum. */
  private async screenshot(page: Page, request: SnapshotRequest): Promise<Uint8Array> {
    const options = { type: request.format, quality: request.quality, captureBeyondViewport: request.fullPage } as const;
    let image: Uint8Array;
    if (request.fullPage) {
      const contentHeight = await page.evaluate(() => Math.max(
        document.documentElement.scrollHeight,
        document.body === null ? 0 : document.body.scrollHeight,
      ));
      const height = Math.min(Math.max(contentHeight, request.viewport.height), this.maxFullHeightPx);
      image = await page.screenshot({ ...options, clip: { x: 0, y: 0, width: request.viewport.width, height } });
    } else {
      image = await page.screenshot(options);
    }
    return image;
  }

  /** Renders one snapshot inside an isolated context. */
  private async render(context: BrowserContext, request: SnapshotRequest, signal?: AbortSignal): Promise<Omit<SnapshotResult, 'renderMs'>> {
    const onAbort = (): void => {
      context.close().catch((error: unknown) => {
        this.logger.debug('Closing the context of an abandoned snapshot failed.', { error: redactedError(error) });
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      signal?.throwIfAborted();
      const page = await context.newPage();
      const blocked: BlockedNavigation[] = [];
      if (request.viewport.userAgent !== null) {
        await page.setUserAgent({ userAgent: request.viewport.userAgent });
      }
      await page.setViewport({
        width: request.viewport.width,
        height: request.viewport.height,
        deviceScaleFactor: request.viewport.deviceScaleFactor,
        isMobile: request.viewport.isMobile,
        hasTouch: request.viewport.hasTouch,
        isLandscape: request.viewport.isLandscape,
      });
      await this.enforcePolicy(page, blocked);
      const response = await this.navigate(page, request, blocked);
      if (request.delayMs > 0) {
        await sleep(request.delayMs, undefined, { signal });
      }
      const image = await this.screenshot(page, request);
      return { image, contentType: CONTENT_TYPES[request.format], finalUrl: response.url(), upstreamStatus: response.status() };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
