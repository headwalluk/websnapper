import { BrowserHost } from './browser/browser-host.js';
import { SnapshotPool } from './browser/snapshot-pool.js';
import type { Config } from './config.js';
import { UrlPolicy } from './guard/url-policy.js';
import type { Logger } from './logger.js';
import { listRules } from './services/rule-service.js';
import { SnapshotService } from './services/snapshot-service.js';
import { dataVersion, type Database } from './store/database.js';

export interface SnapshotRuntime {
  host: BrowserHost;
  pool: SnapshotPool;
  policy: UrlPolicy;
  service: SnapshotService;
}

/** Builds the URL policy over the database's rules. */
export function createUrlPolicy(config: Config, database: Database): UrlPolicy {
  return new UrlPolicy(config.urlPolicy.mode, config.urlPolicy.scope, () => listRules(database), () => dataVersion(database));
}

/** Wires the browser host, pool, policy and snapshot service together. Chromium launches lazily. */
export function createSnapshotRuntime(config: Config, database: Database, logger: Logger): SnapshotRuntime {
  const host = new BrowserHost(config.browser, logger.child('browser'));
  const pool = new SnapshotPool(config.pool.size, config.pool.queueMax, config.pool.queueTimeoutMs);
  const policy = createUrlPolicy(config, database);
  policy.refresh();
  const service = new SnapshotService(host, pool, policy, config, logger.child('snapshot'));
  return { host, pool, policy, service };
}
