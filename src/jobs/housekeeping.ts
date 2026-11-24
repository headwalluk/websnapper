import type { Logger } from '../logger.js';
import { deleteExpiredBans } from '../services/ban-service.js';
import type { Database } from '../store/database.js';

export const HOUSEKEEPING_INTERVAL_MS = 3_600_000;
const RUN_RETENTION_MS = 30 * 86_400_000;

/** Deletes expired bans and old run records, recording the run's outcome. Rethrows on failure. */
export function runHousekeeping(database: Database, logger: Logger, now: number): { expiredBans: number; oldRuns: number } {
  const record = database.prepare('INSERT INTO housekeeping_runs (started_at, finished_at, result, detail) VALUES (?, ?, ?, ?)');
  try {
    const expiredBans = deleteExpiredBans(database, now);
    const oldRuns = Number(database.prepare('DELETE FROM housekeeping_runs WHERE started_at < ?').run(now - RUN_RETENTION_MS).changes);
    const outcome = { expiredBans, oldRuns };
    record.run(now, Date.now(), 'ok', JSON.stringify(outcome));
    logger.debug('Housekeeping finished.', outcome);
    return outcome;
  } catch (error) {
    logger.error('Housekeeping failed.', { error });
    record.run(now, Date.now(), 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Runs housekeeping now and hourly; returns a function that stops it. Call on the primary instance only. */
export function startHousekeeping(database: Database, logger: Logger): () => void {
  let isRunning = false;
  const tick = (): void => {
    if (isRunning) {
      return;
    }
    isRunning = true;
    try {
      runHousekeeping(database, logger, Date.now());
    } catch (error) {
      logger.warn('Housekeeping will retry at the next interval.', { error });
    } finally {
      isRunning = false;
    }
  };
  tick();
  const timer = setInterval(tick, HOUSEKEEPING_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
