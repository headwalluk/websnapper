import { once } from 'node:events';
import type { Server } from 'node:http';
import type { Config } from '../../config.js';
import { RequestGuard } from '../../guard/request-guard.js';
import { buildServer } from '../../http/server.js';
import { startHousekeeping } from '../../jobs/housekeeping.js';
import { createLogger, type Logger } from '../../logger.js';
import { createSnapshotRuntime, type SnapshotRuntime } from '../../runtime.js';
import type { Database } from '../../store/database.js';
import type { Command, CommandResult } from '../command.js';
import { ExitCode } from '../exit-codes.js';
import { withDatabase } from '../helpers.js';

/** Once-only work (housekeeping) runs on this PM2 instance; NODE_APP_INSTANCE defaults to '0'. */
const PRIMARY_INSTANCE = '0';
const SWEEP_INTERVAL_MS = 60_000;
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** Resolves when the process receives SIGINT, SIGTERM or SIGHUP. */
function waitForShutdownSignal(logger: Logger): Promise<void> {
  return new Promise((resolvePromise) => {
    const onSignal = (signal: string): void => {
      for (const name of SHUTDOWN_SIGNALS) {
        process.off(name, onSignal);
      }
      logger.info(`Received ${signal}; shutting down.`);
      resolvePromise();
    };
    for (const name of SHUTDOWN_SIGNALS) {
      process.on(name, onSignal);
    }
  });
}

/** Launches Chromium, wrapping a failure with the configured path. */
async function startBrowser(runtime: SnapshotRuntime, config: Config): Promise<string> {
  try {
    return await runtime.host.start();
  } catch (error) {
    throw new Error(`Could not launch Chromium at ${config.browser.chromiumPath}: ${(error as Error).message}`, { cause: error });
  }
}

/** Stops accepting connections and waits for in-flight requests to finish. */
async function closeServer(server: Server): Promise<void> {
  const closed = once(server, 'close');
  server.close();
  server.closeIdleConnections();
  await closed;
}

/** Runs the server until a shutdown signal arrives. */
async function serve(config: Config, database: Database): Promise<CommandResult> {
  const logger = createLogger({ level: config.logLevel, tag: 'websnapper' });
  if (config.authMode === 'open') {
    logger.warn('Authentication is OFF (WEBSNAPPER_AUTH_MODE=open). Anyone who can reach this port can take snapshots.');
  }
  // serve drains requests on a signal and then closes Chromium, so Puppeteer must not act on it.
  const runtime = createSnapshotRuntime(config, database, logger, { puppeteerHandlesSignals: false });
  if (config.urlPolicy.mode === 'allow-list' && runtime.policy.ruleCount() === 0) {
    logger.warn('URL policy is allow-list with no rules, so every snapshot will be refused.');
  }
  try {
    await startBrowser(runtime, config);
    await listenUntilShutdown(config, database, runtime, logger);
  } finally {
    await runtime.host.close();
  }
  logger.info('Stopped.');
  return { exitCode: ExitCode.success, data: {}, text: '' };
}

/** Listens, runs background timers, and returns once a shutdown signal has drained the server. */
async function listenUntilShutdown(config: Config, database: Database, runtime: SnapshotRuntime, logger: Logger): Promise<void> {
  const guard = new RequestGuard(config, database, logger.child('guard'));
  const server = buildServer({ config, logger: logger.child('http'), guard, snapshotter: runtime.service });
  server.listen(config.listen.port, config.listen.host);
  // once() rejects if 'error' (EADDRINUSE and the like) fires first.
  await once(server, 'listening');
  logger.info(`Listening on http://${config.listen.host}:${config.listen.port} (auth ${config.authMode}, URL policy ${config.urlPolicy.mode}, pool ${config.pool.size})`);

  const stopHousekeeping = config.workerIndex === PRIMARY_INSTANCE ? startHousekeeping(database, logger.child('housekeeping')) : () => undefined;
  // Rate-limit state is per process, so every instance sweeps its own.
  const sweepTimer = setInterval(() => guard.sweep(Date.now()), SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  await waitForShutdownSignal(logger);
  clearInterval(sweepTimer);
  stopHousekeeping();
  await closeServer(server);
}

export const serveCommand: Command = {
  path: ['serve'],
  summary: 'Run the HTTP server until SIGINT, SIGTERM or SIGHUP.',
  usage: 'websnapper serve',
  run: ({ config }) => withDatabase(config, (database) => serve(config, database)),
};
