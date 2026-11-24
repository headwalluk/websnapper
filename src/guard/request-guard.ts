import type { Config } from '../config.js';
import { ServiceError, type ErrorCode } from '../errors.js';
import type { Logger } from '../logger.js';
import { addBan, findActiveBan } from '../services/ban-service.js';
import { findActiveKey, touchKey } from '../services/key-service.js';
import type { Database } from '../store/database.js';
import { RateLimiter } from './rate-limiter.js';

const MS_PER_SECOND = 1000;
const TOUCH_INTERVAL_MS = 60_000;
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;
const BAN_REASON = 'Too many failed or rate-limited requests.';

/** Error codes that count towards a ban. */
const STRIKE_CODES: ReadonlySet<ErrorCode> = new Set([
  'invalid_request', 'unauthorised', 'url_blocked', 'not_found', 'method_not_allowed', 'rate_limited',
]);

/** Extracts a bearer token from an Authorization header. */
export function bearerToken(header: string | undefined): string | null {
  const match = header === undefined ? null : BEARER_PATTERN.exec(header.trim());
  return match?.[1] ?? null;
}

/** Applies bans, rate limits and authentication to incoming requests, and records strikes. */
export class RequestGuard {
  private readonly config: Config;
  private readonly database: Database;
  private readonly logger: Logger;
  private readonly limiter: RateLimiter;
  private readonly lastTouched = new Map<number, number>();

  constructor(config: Config, database: Database, logger: Logger) {
    this.config = config;
    this.database = database;
    this.logger = logger;
    this.limiter = new RateLimiter(config.rateLimit);
  }

  /** Whether an address skips limits and bans. */
  isExempt(ip: string): boolean {
    return this.config.rateLimit.exempt.matches(ip);
  }

  /** Rejects banned or over-limit clients. Throws rate_limited. */
  admit(ip: string, now: number): void {
    if (this.isExempt(ip)) {
      return;
    }
    const ban = findActiveBan(this.database, ip, now);
    if (ban !== null) {
      throw new ServiceError('rate_limited', 'This address is temporarily blocked.', {
        retryAfterSeconds: Math.ceil((ban.expiresAt - now) / MS_PER_SECOND),
      });
    }
    const retryAfterSeconds = this.limiter.consume(ip, now);
    if (retryAfterSeconds > 0) {
      throw new ServiceError('rate_limited', 'Too many requests.', { retryAfterSeconds });
    }
  }

  /** Checks the bearer token in token mode. Throws unauthorised. */
  authenticate(authorisation: string | undefined, ip: string, now: number): void {
    if (this.config.authMode === 'open') {
      return;
    }
    const token = bearerToken(authorisation);
    const key = token === null ? null : findActiveKey(this.database, token);
    if (key === null) {
      this.logger.warn(`Rejected client ${ip}: ${token === null ? 'no bearer token' : 'unknown or revoked token'}`);
      throw new ServiceError('unauthorised', 'A valid bearer token is required.');
    }
    const lastTouched = this.lastTouched.get(key.id) ?? 0;
    if (now - lastTouched >= TOUCH_INTERVAL_MS) {
      touchKey(this.database, key.id, now);
      this.lastTouched.set(key.id, now);
    }
  }

  /** Records a strike for a failed request, banning the client once the threshold is reached. */
  recordFailure(ip: string, code: ErrorCode, now: number): void {
    if (!STRIKE_CODES.has(code) || this.isExempt(ip)) {
      return;
    }
    if (this.limiter.strike(ip, now)) {
      const durationMs = this.config.rateLimit.banDurationSeconds * MS_PER_SECOND;
      addBan(this.database, ip, BAN_REASON, durationMs, now);
      this.logger.warn(`Banned client ${ip} for ${this.config.rateLimit.banDurationSeconds}s`, { lastError: code });
    }
  }

  /** Drops idle rate-limit state; returns how many clients were forgotten. */
  sweep(now: number): number {
    return this.limiter.sweep(now);
  }
}
