import { isIP } from 'node:net';
import { ServiceError } from '../errors.js';
import { normaliseAddress } from '../net/address-list.js';
import { numberColumn, textColumn, type Database } from '../store/database.js';

export interface Ban {
  ip: string;
  reason: string;
  createdAt: number;
  expiresAt: number;
}

/** Maps a bans row to a Ban. */
function toBan(row: Record<string, unknown>): Ban {
  return {
    ip: textColumn(row, 'ip'),
    reason: textColumn(row, 'reason'),
    createdAt: numberColumn(row, 'created_at'),
    expiresAt: numberColumn(row, 'expires_at'),
  };
}

/** Normalises an address, rejecting anything that isn't a single IP. */
function checkedAddress(ip: string): string {
  const normalised = normaliseAddress(ip.trim());
  if (isIP(normalised) === 0) {
    throw new ServiceError('invalid_request', `Not an IP address: "${ip}".`);
  }
  return normalised;
}

/** Returns the active ban for an address, if any. A ban lifts itself once expires_at passes. */
export function findActiveBan(database: Database, ip: string, now: number): Ban | null {
  const row = database.prepare('SELECT * FROM bans WHERE ip = ? AND expires_at > ?').get(normaliseAddress(ip), now);
  return row === undefined ? null : toBan(row);
}

/** Bans an address until now + durationMs, replacing any existing ban. */
export function addBan(database: Database, ip: string, reason: string, durationMs: number, now: number): Ban {
  const ban: Ban = { ip: checkedAddress(ip), reason, createdAt: now, expiresAt: now + durationMs };
  database.prepare('INSERT OR REPLACE INTO bans (ip, reason, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(ban.ip, ban.reason, ban.createdAt, ban.expiresAt);
  return ban;
}

/** Lifts a ban; false when the address isn't banned. */
export function liftBan(database: Database, ip: string, now: number): boolean {
  return Number(database.prepare('DELETE FROM bans WHERE ip = ? AND expires_at > ?').run(checkedAddress(ip), now).changes) > 0;
}

/** Lists active bans, soonest to expire first. */
export function listActiveBans(database: Database, now: number): Ban[] {
  return database.prepare('SELECT * FROM bans WHERE expires_at > ? ORDER BY expires_at').all(now).map(toBan);
}

/** Deletes bans that have expired; returns how many. */
export function deleteExpiredBans(database: Database, now: number): number {
  return Number(database.prepare('DELETE FROM bans WHERE expires_at <= ?').run(now).changes);
}
