import { ServiceError } from '../errors.js';

const QUEUE_FULL_RETRY_SECONDS = 5;

interface Waiter {
  grant: () => void;
  reject: (error: unknown) => void;
}

/** Limits concurrent work to a fixed number of slots, with a bounded FIFO queue for the rest. */
export class SnapshotPool {
  private readonly size: number;
  private readonly queueMax: number;
  private readonly queueTimeoutMs: number;
  private readonly waiters: Waiter[] = [];
  private active = 0;

  constructor(size: number, queueMax: number, queueTimeoutMs: number) {
    this.size = size;
    this.queueMax = queueMax;
    this.queueTimeoutMs = queueTimeoutMs;
  }

  /** Waits for a free slot. Rejects with unavailable when the queue is full or the wait times out. */
  private acquire(signal: AbortSignal | undefined): Promise<void> {
    if (this.active < this.size) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.queueMax) {
      return Promise.reject(new ServiceError('unavailable', 'The snapshot queue is full.', { retryAfterSeconds: QUEUE_FULL_RETRY_SECONDS }));
    }
    return new Promise<void>((resolvePromise, rejectPromise) => {
      const cleanUp = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const position = this.waiters.indexOf(waiter);
        if (position !== -1) {
          this.waiters.splice(position, 1);
        }
      };
      const waiter: Waiter = {
        grant: () => {
          cleanUp();
          resolvePromise();
        },
        reject: (error) => {
          cleanUp();
          rejectPromise(error);
        },
      };
      const onAbort = (): void => waiter.reject(signal?.reason);
      const timer = setTimeout(() => {
        waiter.reject(new ServiceError('unavailable', 'Timed out waiting for a free browser slot.', { retryAfterSeconds: QUEUE_FULL_RETRY_SECONDS }));
      }, this.queueTimeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  /** Hands the slot to the next waiter, or frees it. */
  private release(): void {
    const next = this.waiters[0];
    if (next === undefined) {
      this.active -= 1;
    } else {
      next.grant();
    }
  }

  /** Runs work in a slot, releasing it however the work ends. */
  async run<Result>(work: () => Promise<Result>, signal?: AbortSignal): Promise<Result> {
    signal?.throwIfAborted();
    await this.acquire(signal);
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  /** Current activity, for health output. */
  stats(): { active: number; queued: number; size: number } {
    return { active: this.active, queued: this.waiters.length, size: this.size };
  }
}
