import type { UrlPolicyMode, UrlPolicyScope } from '../config.js';
import type { UrlRule } from '../services/rule-service.js';

const NAVIGABLE_PROTOCOLS = new Set(['http:', 'https:']);
/** Inline resources a page builds itself; there is no remote target to police. */
const INLINE_PROTOCOLS = new Set(['data:', 'blob:']);

export interface CompiledRule {
  id: number;
  pattern: string;
  expression: RegExp;
}

export interface PolicyVerdict {
  allowed: boolean;
  reason: string;
  matchedRule: { id: number; pattern: string } | null;
}

/** Compiles stored rules; patterns were validated when added, so a failure here is a real error. */
export function compileRules(rules: readonly UrlRule[]): CompiledRule[] {
  return rules.map((rule) => ({ id: rule.id, pattern: rule.pattern, expression: new RegExp(rule.pattern) }));
}

/** Decides whether a URL may be loaded. Navigations must be http(s); subresources may also be inline. */
export function evaluateUrl(mode: UrlPolicyMode, rules: readonly CompiledRule[], url: string, isNavigation: boolean): PolicyVerdict {
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (parsed === null) {
    return { allowed: false, reason: 'Not a valid URL.', matchedRule: null };
  }
  if (!isNavigation && INLINE_PROTOCOLS.has(parsed.protocol)) {
    return { allowed: true, reason: 'Inline resource.', matchedRule: null };
  }
  if (!NAVIGABLE_PROTOCOLS.has(parsed.protocol)) {
    return { allowed: false, reason: `The ${parsed.protocol} scheme is not allowed; use http or https.`, matchedRule: null };
  }
  const match = mode === 'open' ? undefined : rules.find((rule) => rule.expression.test(parsed.href));
  const matchedRule = match === undefined ? null : { id: match.id, pattern: match.pattern };
  let verdict: PolicyVerdict;
  if (mode === 'open') {
    verdict = { allowed: true, reason: 'URL policy is open.', matchedRule };
  } else if (mode === 'allow-list') {
    verdict = match === undefined
      ? { allowed: false, reason: 'No allow-list rule matches this URL.', matchedRule }
      : { allowed: true, reason: `Allowed by rule ${match.id}.`, matchedRule };
  } else {
    verdict = match === undefined
      ? { allowed: true, reason: 'No block-list rule matches this URL.', matchedRule }
      : { allowed: false, reason: `Blocked by rule ${match.id}.`, matchedRule };
  }
  return verdict;
}

/** The URL policy with its rules cached, reloaded when the rule source reports a change. */
export class UrlPolicy {
  readonly mode: UrlPolicyMode;
  readonly scope: UrlPolicyScope;
  private readonly loadRules: () => UrlRule[];
  private readonly currentVersion: () => number;
  private rules: CompiledRule[] = [];
  private loadedVersion: number | null = null;

  constructor(mode: UrlPolicyMode, scope: UrlPolicyScope, loadRules: () => UrlRule[], currentVersion: () => number) {
    this.mode = mode;
    this.scope = scope;
    this.loadRules = loadRules;
    this.currentVersion = currentVersion;
  }

  /** Reloads the rules if the source has changed since they were last loaded. */
  refresh(): void {
    const version = this.currentVersion();
    if (this.mode !== 'open' && version !== this.loadedVersion) {
      this.rules = compileRules(this.loadRules());
      this.loadedVersion = version;
    }
  }

  /** Whether requests other than navigations need checking under this policy. */
  checksSubresources(): boolean {
    return this.mode !== 'open' && this.scope === 'all';
  }

  /** Evaluates a URL against the cached rules. */
  evaluate(url: string, isNavigation: boolean): PolicyVerdict {
    return evaluateUrl(this.mode, this.rules, url, isNavigation);
  }

  /** Number of rules currently loaded. */
  ruleCount(): number {
    return this.rules.length;
  }
}
