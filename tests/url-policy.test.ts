import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileRules, evaluateUrl, UrlPolicy } from '../src/guard/url-policy.js';
import type { UrlRule } from '../src/services/rule-service.js';

const PRIVATE_RULES: UrlRule[] = [
  { id: 1, pattern: '^https?://(localhost|127\\.|10\\.|192\\.168\\.)', note: 'private', createdAt: 0 },
  { id: 2, pattern: '^https://intranet\\.example\\.com/', note: '', createdAt: 0 },
];
const COMPILED = compileRules(PRIVATE_RULES);

test('open mode allows any http(s) URL but never other schemes', () => {
  assert.equal(evaluateUrl('open', [], 'https://example.com/', true).allowed, true);
  assert.equal(evaluateUrl('open', [], 'file:///etc/passwd', true).allowed, false);
  assert.equal(evaluateUrl('open', [], 'javascript:alert(1)', true).allowed, false);
});

test('block-list refuses matching URLs and names the rule', () => {
  const verdict = evaluateUrl('block-list', COMPILED, 'http://192.168.1.1/admin', true);
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.matchedRule?.id, 1);
  assert.equal(evaluateUrl('block-list', COMPILED, 'https://example.com/', true).allowed, true);
});

test('allow-list permits only matching URLs', () => {
  assert.equal(evaluateUrl('allow-list', COMPILED, 'https://intranet.example.com/page', true).allowed, true);
  assert.equal(evaluateUrl('allow-list', COMPILED, 'https://example.org/', true).allowed, false);
  assert.equal(evaluateUrl('allow-list', [], 'https://example.org/', true).allowed, false);
});

test('rules match the normalised URL, so case tricks in the host do not slip past', () => {
  assert.equal(evaluateUrl('block-list', COMPILED, 'HTTP://LOCALHOST:8080/', true).allowed, false);
});

test('inline subresources are allowed, inline navigations are not', () => {
  assert.equal(evaluateUrl('allow-list', [], 'data:image/png;base64,AAAA', false).allowed, true);
  assert.equal(evaluateUrl('open', [], 'data:text/html,<h1>x</h1>', true).allowed, false);
});

test('the policy reloads rules only when the data version changes', () => {
  let version = 1;
  let loads = 0;
  const policy = new UrlPolicy('block-list', 'all', () => {
    loads += 1;
    return PRIVATE_RULES;
  }, () => version);
  policy.refresh();
  policy.refresh();
  assert.equal(loads, 1);
  version = 2;
  policy.refresh();
  assert.equal(loads, 2);
  assert.equal(policy.ruleCount(), 2);
  assert.equal(policy.checksSubresources(), true);
  assert.equal(new UrlPolicy('block-list', 'navigation', () => [], () => 1).checksSubresources(), false);
});
