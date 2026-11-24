import { createHash, randomBytes } from 'node:crypto';
import { ServiceError } from '../errors.js';
import { numberColumn, optionalNumberColumn, textColumn, type Database } from '../store/database.js';

const TOKEN_PREFIX = 'wsk_';
const TOKEN_BYTES = 32;
const MAX_LABEL_LENGTH = 200;

export interface ApiKey {
  id: number;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** Hashes a token for storage and lookup; tokens themselves are never stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Maps an api_keys row to an ApiKey. */
function toApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: numberColumn(row, 'id'),
    label: textColumn(row, 'label'),
    createdAt: numberColumn(row, 'created_at'),
    lastUsedAt: optionalNumberColumn(row, 'last_used_at'),
    revokedAt: optionalNumberColumn(row, 'revoked_at'),
  };
}

/** Mints a key and returns it with its token, which is shown once and never again. */
export function createKey(database: Database, label: string, now: number): { key: ApiKey; token: string } {
  const trimmed = label.trim();
  if (trimmed === '' || trimmed.length > MAX_LABEL_LENGTH) {
    throw new ServiceError('invalid_request', `A key needs a label of 1 to ${MAX_LABEL_LENGTH} characters.`);
  }
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  const result = database.prepare('INSERT INTO api_keys (label, token_hash, created_at) VALUES (?, ?, ?)').run(trimmed, hashToken(token), now);
  const key: ApiKey = { id: Number(result.lastInsertRowid), label: trimmed, createdAt: now, lastUsedAt: null, revokedAt: null };
  return { key, token };
}

/** Lists every key, revoked ones included, oldest first. */
export function listKeys(database: Database): ApiKey[] {
  return database.prepare('SELECT * FROM api_keys ORDER BY id').all().map(toApiKey);
}

/** Revokes a key; false when there is no such unrevoked key. */
export function revokeKey(database: Database, id: number, now: number): boolean {
  const result = database.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, id);
  return Number(result.changes) > 0;
}

/** Finds the unrevoked key a token belongs to. */
export function findActiveKey(database: Database, token: string): ApiKey | null {
  const row = database.prepare('SELECT * FROM api_keys WHERE token_hash = ? AND revoked_at IS NULL').get(hashToken(token));
  return row === undefined ? null : toApiKey(row);
}

/** Records when a key was last used. */
export function touchKey(database: Database, id: number, now: number): void {
  database.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now, id);
}

/** Counts keys that can still authenticate. */
export function countActiveKeys(database: Database): number {
  const row = database.prepare('SELECT COUNT(*) AS total FROM api_keys WHERE revoked_at IS NULL').get();
  return row === undefined ? 0 : numberColumn(row, 'total');
}
