import { ServiceError } from '../errors.js';
import { numberColumn, textColumn, type Database } from '../store/database.js';

const MAX_PATTERN_LENGTH = 1000;
const COMMENT_MARKER = '#';

export interface UrlRule {
  id: number;
  pattern: string;
  note: string;
  createdAt: number;
}

export interface ParsedRuleLine {
  lineNumber: number;
  pattern: string;
  note: string;
}

/** Returns why a pattern can't be used, or null when it compiles. */
export function patternProblem(pattern: string): string | null {
  let problem: string | null = null;
  if (pattern === '' || pattern.length > MAX_PATTERN_LENGTH) {
    problem = `A pattern must be 1 to ${MAX_PATTERN_LENGTH} characters.`;
  } else {
    try {
      new RegExp(pattern);
    } catch (error) {
      problem = `Not a valid regular expression: ${(error as Error).message}`;
    }
  }
  return problem;
}

/** Maps a url_rules row to a UrlRule. */
function toRule(row: Record<string, unknown>): UrlRule {
  return {
    id: numberColumn(row, 'id'),
    pattern: textColumn(row, 'pattern'),
    note: textColumn(row, 'note'),
    createdAt: numberColumn(row, 'created_at'),
  };
}

/** Adds a rule after checking it compiles; rejects duplicates. */
export function addRule(database: Database, pattern: string, note: string, now: number): UrlRule {
  const problem = patternProblem(pattern);
  if (problem !== null) {
    throw new ServiceError('invalid_request', problem);
  }
  const existing = database.prepare('SELECT id FROM url_rules WHERE pattern = ?').get(pattern);
  if (existing !== undefined) {
    throw new ServiceError('invalid_request', `That pattern is already rule ${numberColumn(existing, 'id')}.`);
  }
  const result = database.prepare('INSERT INTO url_rules (pattern, note, created_at) VALUES (?, ?, ?)').run(pattern, note.trim(), now);
  return { id: Number(result.lastInsertRowid), pattern, note: note.trim(), createdAt: now };
}

/** Lists every rule, oldest first. */
export function listRules(database: Database): UrlRule[] {
  return database.prepare('SELECT * FROM url_rules ORDER BY id').all().map(toRule);
}

/** Removes a rule; false when there is no such rule. */
export function removeRule(database: Database, id: number): boolean {
  return Number(database.prepare('DELETE FROM url_rules WHERE id = ?').run(id).changes) > 0;
}

/** Parses rules text: one pattern per line; a "#" comment line just above a pattern becomes its note. */
export function parseRulesText(text: string): ParsedRuleLine[] {
  const parsed: ParsedRuleLine[] = [];
  let pendingNote = '';
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === '') {
      pendingNote = '';
    } else if (line.startsWith(COMMENT_MARKER)) {
      pendingNote = line.slice(COMMENT_MARKER.length).trim();
    } else {
      parsed.push({ lineNumber: index + 1, pattern: line, note: pendingNote });
      pendingNote = '';
    }
  }
  return parsed;
}

/** Imports rules text in one transaction. Invalid lines abort the import; duplicates are skipped. */
export function importRules(database: Database, text: string, now: number): { added: UrlRule[]; skipped: string[] } {
  const lines = parseRulesText(text);
  const problems = lines
    .map((line) => ({ line, problem: patternProblem(line.pattern) }))
    .filter((entry) => entry.problem !== null)
    .map((entry) => `Line ${entry.line.lineNumber}: ${entry.problem}`);
  if (problems.length > 0) {
    throw new ServiceError('invalid_request', problems.join('\n'));
  }
  const added: UrlRule[] = [];
  const skipped: string[] = [];
  const existing = new Set(listRules(database).map((rule) => rule.pattern));
  database.exec('BEGIN');
  try {
    for (const line of lines) {
      if (existing.has(line.pattern)) {
        skipped.push(line.pattern);
        continue;
      }
      added.push(addRule(database, line.pattern, line.note, now));
      existing.add(line.pattern);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { added, skipped };
}

/** Renders rules in the format importRules reads. */
export function exportRules(rules: readonly UrlRule[]): string {
  return rules.map((rule) => (rule.note === '' ? rule.pattern : `${COMMENT_MARKER} ${rule.note}\n${rule.pattern}`)).join('\n\n');
}
