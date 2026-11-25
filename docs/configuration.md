# Configuration

For operators. Settings come from `.env` beside `package.json` (copy `.env.sample`), then the
process environment, which wins. Every setting has a safe default. Invalid or unknown
`WEBSNAPPER_*` settings stop the server and CLI with every problem listed at once; check with
`websnapper config`.

`WEBSNAPPER_ENV_FILE` (environment only) points at a different settings file, for example
`/etc/websnapper/websnapper.env` under systemd.

API keys, URL rules and bans are not settings: they live in the database and are managed with
the [CLI](cli.md).

## Server

| Setting | Default | |
|---|---|---|
| `WEBSNAPPER_HOST` | `127.0.0.1` | Listen address. Use `0.0.0.0` to serve the LAN directly |
| `WEBSNAPPER_PORT` | `8490` | |
| `WEBSNAPPER_TRUSTED_PROXIES` | empty | IPs or CIDR ranges of reverse proxies. Only these may set the client address through `X-Forwarded-For` |
| `WEBSNAPPER_LOG_LEVEL` | `info` | `warn`, `info` or `debug`. Errors are always logged |

Behind a proxy, set `WEBSNAPPER_TRUSTED_PROXIES` to the proxy's address. Without it every
request appears to come from the proxy, and one noisy client gets the proxy banned.

## Authentication

| Setting | Default | |
|---|---|---|
| `WEBSNAPPER_AUTH_MODE` | `token` | `token` needs a bearer token on `/v1/*`; `open` needs nothing and logs a warning at start-up |
| `WEBSNAPPER_DATABASE_PATH` | `./data/websnapper.sqlite` | Keys, rules and bans. Relative to the project root |

## URL policy

| Setting | Default | |
|---|---|---|
| `WEBSNAPPER_URL_POLICY` | `open` | `open`: any http(s) URL. `allow-list`: only URLs matching a rule. `block-list`: any URL except those matching a rule |
| `WEBSNAPPER_URL_POLICY_SCOPE` | `all` | `all`: every request the page makes is checked (images, scripts, frames, redirects). `navigation`: only the page itself, its redirects and its frames |

Only `http` and `https` targets are ever accepted. With `allow-list` and scope `all`, pages
render without anything they load from hosts that aren't allowed (CDNs, fonts); use scope
`navigation` if that is a problem. An `allow-list` with no rules refuses everything.

Rules are managed with `websnapper rule`; `config/` has ready-made block-list templates (private
networks, HTTPS only). See the [CLI](cli.md#url-rules).

## Browser and pool

| Setting | Default | |
|---|---|---|
| `WEBSNAPPER_CHROMIUM_PATH` | `/usr/bin/chromium` | |
| `WEBSNAPPER_POOL_SIZE` | `3` | Snapshots rendered at once, each in its own isolated browser context. Each needs roughly 100–300 MB |
| `WEBSNAPPER_QUEUE_MAX` | `20` | Requests that may wait for a slot; more get 503 |
| `WEBSNAPPER_QUEUE_TIMEOUT_MS` | `15000` | Longest wait for a slot before 503 |
| `WEBSNAPPER_NAVIGATION_TIMEOUT_MS` | `20000` | Longest page load before 504 |
| `WEBSNAPPER_BROWSER_RECYCLE_AFTER` | `500` | Chromium is relaunched after this many snapshots |
| `WEBSNAPPER_IGNORE_TLS_ERRORS` | `false` | Accept self-signed or invalid certificates on targets |

## Snapshot defaults and limits

| Setting | Default | |
|---|---|---|
| `WEBSNAPPER_DEFAULT_FORMAT` | `png` | Used when a request has no `format` |
| `WEBSNAPPER_DEFAULT_QUALITY` | `80` | Used for `jpeg`/`webp` when a request has no `quality` |
| `WEBSNAPPER_MAX_WIDTH_PX` | `3840` | |
| `WEBSNAPPER_MAX_HEIGHT_PX` | `2160` | For fixed-height captures; must not exceed the full-page maximum |
| `WEBSNAPPER_MAX_FULL_HEIGHT_PX` | `16000` | Full-page captures are cut off here. At most 16384, Chromium's limit |
| `WEBSNAPPER_MAX_DELAY_MS` | `5000` | |

## Rate limiting and bans

| Setting | Default | |
|---|---|---|
| `WEBSNAPPER_RATE_LIMIT_PER_MINUTE` | `60` | Sustained requests per minute per address |
| `WEBSNAPPER_RATE_LIMIT_BURST` | `10` | Requests an address may make at once |
| `WEBSNAPPER_BAN_STRIKES` | `20` | Failed requests (400, 401, 403, 404, 405, 429) within the window that ban an address |
| `WEBSNAPPER_BAN_WINDOW_SECONDS` | `60` | |
| `WEBSNAPPER_BAN_DURATION_SECONDS` | `900` | Bans lift themselves after this |
| `WEBSNAPPER_RATE_LIMIT_EXEMPT` | empty | IPs or CIDR ranges never limited or banned |

Rate-limit counters are kept in memory and reset on restart. Bans are kept in the database, so
they survive restarts and can be listed and lifted with `websnapper ban`.

Each ban is logged as one line, for fail2ban or similar:

```
2026-01-01T12:00:00.000Z warn  [websnapper:guard] Banned client 203.0.113.9 for 900s {"lastError":"not_found"}
```

## Environment only

| Setting | |
|---|---|
| `WEBSNAPPER_ENV_FILE` | Path of the settings file to read instead of `.env` |
| `NODE_APP_INSTANCE` | Set by PM2. Hourly housekeeping runs only on instance `0` |
