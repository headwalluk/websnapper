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

/** How a new ban meets an existing one: the operator replaces it; automatic bans never shorten it. */
export type BanMerge = 'replace' | 'keep-later';

const BAN_UPSERT_SQL: Record<BanMerge, string> = {
  'replace': 'INSERT OR REPLACE INTO bans (ip, reason, created_at, expires_at) VALUES (?, ?, ?, ?)',
  'keep-later': `INSERT INTO bans (ip, reason, created_at, expires_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (ip) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at, expires_at = excluded.expires_at
    WHERE excluded.expires_at > bans.expires_at`,
};

/** Bans an address until now + durationMs and returns the ban now in force. */
export function addBan(database: Database, ip: string, reason: string, durationMs: number, now: number, merge: BanMerge = 'replace'): Ban {
  const address = checkedAddress(ip);
  database.prepare(BAN_UPSERT_SQL[merge]).run(address, reason, now, now + durationMs);
  const row = database.prepare('SELECT * FROM bans WHERE ip = ?').get(address);
  if (row === undefined) {
    throw new Error(`The ban on ${address} was not stored.`);
  }
  return toBan(row);
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
