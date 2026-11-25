const URL_IN_TEXT_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/g;
const UNPARSEABLE_URL = '(unparseable URL)';

/** Reduces a URL to origin and path for logs, since query strings can carry credentials. */
export function redactUrl(url: URL | string): string {
  let parsed: URL | null = null;
  if (url instanceof URL) {
    parsed = url;
  } else if (URL.canParse(url)) {
    parsed = new URL(url);
  }
  return parsed === null ? UNPARSEABLE_URL : `${parsed.origin}${parsed.pathname}${parsed.search === '' ? '' : '?…'}`;
}

/** Redacts every http(s) URL inside free text, such as a browser error message. */
export function redactUrlsIn(text: string): string {
  return text.replace(URL_IN_TEXT_PATTERN, (match) => redactUrl(match));
}

/** Copies an error for logging with every URL in its message and stack redacted. */
export function redactedError(error: unknown): { name: string; message: string; stack?: string } {
  const source = error instanceof Error ? error : new Error(String(error));
  const redacted: { name: string; message: string; stack?: string } = { name: source.name, message: redactUrlsIn(source.message) };
  if (source.stack !== undefined) {
    redacted.stack = redactUrlsIn(source.stack);
  }
  return redacted;
}
