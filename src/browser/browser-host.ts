import puppeteer, { type Browser, type BrowserContext } from 'puppeteer-core';
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

interface BrowserGeneration {
  browser: Browser;
  used: number;
  inFlight: number;
  retiring: boolean;
}

export type BrowserLauncher = (settings: Config['browser']) => Promise<Browser>;

/** Launches the configured Chromium headless, with the sandbox left on. */
export const launchChromium: BrowserLauncher = (settings) => puppeteer.launch({
  executablePath: settings.chromiumPath,
  headless: true,
  acceptInsecureCerts: settings.ignoreTlsErrors,
  args: CHROMIUM_ARGS,
});

/**
 * Owns one long-lived Chromium and hands out isolated BrowserContexts. Relaunches after a crash,
 * and after recycleAfter contexts: the old browser closes once its last context is done.
 */
export class BrowserHost {
  private readonly settings: Config['browser'];
  private readonly logger: Logger;
  private readonly launcher: BrowserLauncher;
  private current: BrowserGeneration | null = null;
  private launching: Promise<BrowserGeneration> | null = null;
  private closed = false;

  constructor(settings: Config['browser'], logger: Logger, launcher: BrowserLauncher = launchChromium) {
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
    const generation: BrowserGeneration = { browser, used: 0, inFlight: 0, retiring: false };
    browser.on('disconnected', () => {
      if (this.current === generation) {
        this.current = null;
        if (!this.closed) {
          this.logger.warn('Chromium disconnected; it will be relaunched on the next request.');
        }
      }
    });
    this.current = generation;
    this.logger.info(`Chromium started: ${await browser.version()}`);
    return generation;
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
    const current = this.current;
    this.current = null;
    if (current !== null && current.browser.connected) {
      await current.browser.close();
    }
  }
}
