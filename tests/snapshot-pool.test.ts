import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { SnapshotPool } from '../src/browser/snapshot-pool.js';
import { ServiceError } from '../src/errors.js';

/** Returns a promise and the function that resolves it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

test('work beyond the pool size waits its turn, in order', async () => {
  const pool = new SnapshotPool(1, 5, 5000);
  const gate = deferred();
  const order: string[] = [];
  const first = pool.run(async () => {
    await gate.promise;
    order.push('first');
  });
  const second = pool.run(async () => {
    order.push('second');
  });
  await sleep(10);
  assert.deepEqual(pool.stats(), { active: 1, queued: 1, size: 1 });
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'second']);
  assert.deepEqual(pool.stats(), { active: 0, queued: 0, size: 1 });
});

test('a full queue is refused at once as unavailable', async () => {
  const pool = new SnapshotPool(1, 0, 5000);
  const gate = deferred();
  const running = pool.run(() => gate.promise);
  await assert.rejects(pool.run(async () => undefined), (error: unknown) => error instanceof ServiceError && error.code === 'unavailable');
  gate.resolve();
  await running;
});

test('a queued request times out, and an aborted one leaves the queue', async () => {
  const pool = new SnapshotPool(1, 5, 50);
  const gate = deferred();
  const running = pool.run(() => gate.promise);
  await assert.rejects(pool.run(async () => undefined), ServiceError);
  const controller = new AbortController();
  const aborted = pool.run(async () => undefined, controller.signal);
  controller.abort(new Error('client left'));
  await assert.rejects(aborted, /client left/);
  assert.equal(pool.stats().queued, 0);
  gate.resolve();
  await running;
});

test('a failing job releases its slot', async () => {
  const pool = new SnapshotPool(1, 1, 1000);
  await assert.rejects(pool.run(async () => {
    throw new Error('boom');
  }), /boom/);
  assert.equal(await pool.run(async () => 'next'), 'next');
});
