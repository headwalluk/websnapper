import puppeteer, { type Browser, type BrowserContext, type LaunchOptions } from 'puppeteer-core';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

const CHROMIUM_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-extensions',
  '--hide-scrollbars',
  '--mute-audio',
];
const RELAUNCH_FIRST_DELAY_MS = 1000;
const RELAUNCH_MAX_DELAY_MS = 60_000;
/** A browser that stayed up this long before disconnecting resets the relaunch backoff. */
const RELAUNCH_STABLE_AFTER_MS = 60_000;

interface BrowserGeneration {
  browser: Browser;
  used: number;
  inFlight: number;
  retiring: boolean;
  startedAt: number;
}

export type BrowserLauncher = (settings: Config['browser']) => Promise<Browser>;

/**
 * Launch options for the configured Chromium: headless, sandbox on. With handleSignals false,
 * Puppeteer installs no SIGINT/SIGTERM/SIGHUP handlers (its SIGINT handler calls process.exit),
 * so a caller with its own graceful shutdown stays in charge and closes the browser itself.
 */
export function chromiumLaunchOptions(settings: Config['browser'], handleSignals: boolean): LaunchOptions {
  return {
    executablePath: settings.chromiumPath,
    headless: true,
    acceptInsecureCerts: settings.ignoreTlsErrors,
    args: CHROMIUM_ARGS,
    handleSIGINT: handleSignals,
    handleSIGTERM: handleSignals,
    handleSIGHUP: handleSignals,
  };
}

/** Returns a launcher for the configured Chromium. */
export function chromiumLauncher(handleSignals: boolean): BrowserLauncher {
  return (settings) => puppeteer.launch(chromiumLaunchOptions(settings, handleSignals));
}

/**
 * Owns one long-lived Chromium and hands out isolated BrowserContexts. Relaunches after a crash
 * (with backoff, so /health recovers without traffic), and after recycleAfter contexts: the old
 * browser closes once its last context is done.
 */
export class BrowserHost {
  private readonly settings: Config['browser'];
  private readonly logger: Logger;
  private readonly launcher: BrowserLauncher;
  private current: BrowserGeneration | null = null;
  private launching: Promise<BrowserGeneration> | null = null;
  private closed = false;
  private relaunchTimer: NodeJS.Timeout | null = null;
  private relaunchAttempts = 0;

  constructor(settings: Config['browser'], logger: Logger, launcher: BrowserLauncher = chromiumLauncher(true)) {
    this.settings = settings;
    this.logger = logger;
    this.launcher = launcher;
  }

  /** Launches Chromium now rather than on the first request. */
  async start(): Promise<string> {
    const generation = await this.generation();
    return generation.browser.version();
  }

  /** Whether a connected browser is ready. */
  isReady(): boolean {
    return this.current !== null && this.current.browser.connected && !this.closed;
  }

  /** Returns the current browser generation, launching one if needed. */
  private async generation(): Promise<BrowserGeneration> {
    const current = this.current;
    if (current !== null && current.browser.connected && !current.retiring) {
      return current;
    }
    this.launching ??= this.launch().finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  /** Launches a new browser and makes it current. */
  private async launch(): Promise<BrowserGeneration> {
    if (this.closed) {
      throw new Error('The browser host has been closed.');
    }
    const browser = await this.launcher(this.settings);
    const generation: BrowserGeneration = { browser, used: 0, inFlight: 0, retiring: false, startedAt: Date.now() };
    browser.on('disconnected', () => {
      this.onDisconnected(generation);
    });
    this.current = generation;
    this.logger.info(`Chromium started: ${await browser.version()}`);
    return generation;
  }

  /** Forgets a disconnected current browser and schedules a relaunch, unless the host is closed. */
  private onDisconnected(generation: BrowserGeneration): void {
    if (this.current !== generation || this.closed) {
      return;
    }
    this.current = null;
    if (generation.retiring || Date.now() - generation.startedAt >= RELAUNCH_STABLE_AFTER_MS) {
      this.relaunchAttempts = 0;
    }
    if (!generation.retiring) {
      this.logger.warn('Chromium disconnected; relaunching.');
    }
    this.scheduleRelaunch();
  }

  /** Relaunches the browser after a growing delay; one timer at a time, retried until it works. */
  private scheduleRelaunch(): void {
    if (this.closed || this.relaunchTimer !== null) {
      return;
    }
    const delayMs = Math.min(RELAUNCH_FIRST_DELAY_MS * 2 ** this.relaunchAttempts, RELAUNCH_MAX_DELAY_MS);
    this.relaunchAttempts += 1;
    this.relaunchTimer = setTimeout(() => {
      this.relaunchTimer = null;
      this.generation().catch((error: unknown) => {
        if (this.closed) {
          this.logger.debug('Stopped relaunching Chromium: the host was closed.', { error });
        } else {
          this.logger.error(`Could not relaunch Chromium (attempt ${this.relaunchAttempts}); retrying.`, { error });
          this.scheduleRelaunch();
        }
      });
    }, delayMs);
    this.relaunchTimer.unref();
  }

  /** Closes a retired generation once nothing is using it. */
  private async closeIfDrained(generation: BrowserGeneration): Promise<void> {
    if (generation.retiring && generation.inFlight === 0 && generation.browser.connected) {
      this.logger.info(`Recycling Chromium after ${generation.used} snapshots.`);
      await generation.browser.close();
    }
  }

  /** Runs work in a fresh BrowserContext, closing the context afterwards. */
  async withContext<Result>(work: (context: BrowserContext) => Promise<Result>): Promise<Result> {
    const generation = await this.generation();
    generation.used += 1;
    generation.inFlight += 1;
    if (generation.used >= this.settings.recycleAfter) {
      generation.retiring = true;
    }
    let context: BrowserContext | null = null;
    try {
      context = await generation.browser.createBrowserContext();
      return await work(context);
    } finally {
      generation.inFlight -= 1;
      await this.closeContext(context);
      await this.closeIfDrained(generation);
    }
  }

  /** Closes a context, logging rather than throwing when the browser is already gone. */
  private async closeContext(context: BrowserContext | null): Promise<void> {
    if (context === null || context.closed) {
      return;
    }
    try {
      await context.close();
    } catch (error) {
      this.logger.warn('Could not close a browser context; the browser may have exited.', { error });
    }
  }

  /** Closes the browser and refuses further work. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.relaunchTimer !== null) {
      clearTimeout(this.relaunchTimer);
      this.relaunchTimer = null;
    }
    const current = this.current;
    this.current = null;
    if (current !== null && current.browser.connected) {
      await current.browser.close();
    }
  }
}
