import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock, test } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { BrowserHost, chromiumLaunchOptions } from '../src/browser/browser-host.js';
import { quietLogger, testConfig } from './helpers/fixtures.js';

const settings = testConfig().browser;

/** A stand-in for a Puppeteer Browser: connected until disconnect() is called. */
class FakeBrowser extends EventEmitter {
  connected = true;

  async version(): Promise<string> {
    return 'FakeChromium/1';
  }

  async close(): Promise<void> {
    this.disconnect();
  }

  disconnect(): void {
    this.connected = false;
    this.emit('disconnected');
  }
}

/** Lets pending promise callbacks run; setImmediate is not mocked, only setTimeout. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test('the server launch options leave signal handling to websnapper', () => {
  const options = chromiumLaunchOptions(settings, false);
  assert.deepEqual([options.handleSIGINT, options.handleSIGTERM, options.handleSIGHUP], [false, false, false]);
  assert.equal(chromiumLaunchOptions(settings, true).handleSIGINT, true);
});

test('a crashed browser is relaunched without waiting for a snapshot, with backoff', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const browsers: FakeBrowser[] = [];
  let failNextLaunch = false;
  const host = new BrowserHost(settings, quietLogger(), async () => {
    if (failNextLaunch) {
      failNextLaunch = false;
      throw new Error('Chromium would not start');
    }
    const browser = new FakeBrowser();
    browsers.push(browser);
    return browser as unknown as Browser;
  });
  try {
    await host.start();
    failNextLaunch = true;
    browsers[0]?.disconnect();
    assert.equal(host.isReady(), false);
    mock.timers.tick(1000);
    await settle();
    assert.equal(browsers.length, 1, 'the first relaunch failed');
    mock.timers.tick(1999);
    await settle();
    assert.equal(browsers.length, 1, 'the retry waits twice as long');
    mock.timers.tick(1);
    await settle();
    assert.equal(browsers.length, 2);
    assert.equal(host.isReady(), true);
  } finally {
    await host.close();
    mock.timers.reset();
  }
});

test('closing the host cancels a pending relaunch', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  let launches = 0;
  const browsers: FakeBrowser[] = [];
  const host = new BrowserHost(settings, quietLogger(), async () => {
    launches += 1;
    const browser = new FakeBrowser();
    browsers.push(browser);
    return browser as unknown as Browser;
  });
  try {
    await host.start();
    browsers[0]?.disconnect();
    await host.close();
    mock.timers.tick(60_000);
    await settle();
    assert.equal(launches, 1);
  } finally {
    mock.timers.reset();
  }
});
