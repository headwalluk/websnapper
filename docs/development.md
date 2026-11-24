# Development

For developers working on websnapper.

## Commands

```
npm install
npm run websnapper -- <command>   # the CLI, from source
npm run dev                       # serve, restarting on change
npm run check                     # typecheck, lint and tests: run before calling work done
npm run build                     # compile to dist/
```

Tests use `node:test`. `tests/browser.test.ts` drives a real Chromium against a local HTTP server
and is skipped when `WEBSNAPPER_CHROMIUM_PATH` doesn't exist. No test touches the network.

## Layout

```
src/config.ts            the only reader of process.env and .env
src/errors.ts            error codes → HTTP status (the API contract)
src/net/                 IP and CIDR matching
src/guard/               URL policy, rate limiter, client IP, auth and bans per request
src/browser/             Chromium host, the concurrency pool, viewport presets
src/services/            snapshots, keys, rules and bans; shared by HTTP and CLI
src/store/               SQLite (node:sqlite) and migrations
src/jobs/                hourly housekeeping
src/http/                node:http server and responses
src/cli/                 bin/websnapper: command registry and commands
```

## How a snapshot request flows

1. Client address resolved (`X-Forwarded-For` only from trusted proxies)
2. Ban check, then rate limit
3. Route; `/v1/*` checks the bearer token
4. Parameters validated, every problem reported together
5. URL policy checked against the target
6. A pool slot is awaited (bounded queue)
7. A fresh `BrowserContext` (isolated cookies, cache and storage) and page; with a non-open
   policy, request interception applies the policy to redirects, frames and (scope `all`)
   subresources
8. `page.goto`; failures and 4xx/5xx responses become errors, never images
9. Screenshot, context closed, slot released

Failures with 400/401/403/404/405/429 add a strike against the client address. Enough strikes
in the window writes a ban to the database.

## Design notes

- **One process, one Chromium.** Concurrency comes from contexts inside one browser, bounded by
  the pool. Clustering would only multiply browsers and split the rate-limit state
- **The rule cache reloads on `PRAGMA data_version`.** It changes when another connection
  (the CLI) commits, so the server picks up rule changes without polling a table or restarting.
  Keys and bans are read per request, which is cheap
- **Upstream errors are 502, not passed through,** so a target's 401/429 can't be confused with
  websnapper's own
- **Formats are chosen per request.** Rendering several and keeping the smallest was turned
  down: it multiplies encode time, and WebP wins nearly every time
- **Housekeeping is a timer, not cron.** One fixed hourly interval doesn't need a scheduler
  dependency. It runs only on PM2 instance `0`
- **No framework.** Three routes on `node:http`. The only runtime dependency is `puppeteer-core`

## Adding a setting

Add it to `src/config.ts` (including `KNOWN_VARIABLES`), `.env.sample` and
`docs/configuration.md` in the same change. Tests fail if any of the three disagree.

## Adding an error code

Add it to `src/errors.ts`, `ERROR_EXIT_CODES` in `src/cli/helpers.ts` and the table in
`docs/api.md`. Tests check the documentation.

## Changing the schema

Append a migration to `src/store/migrations.ts`. Never edit a released one.
