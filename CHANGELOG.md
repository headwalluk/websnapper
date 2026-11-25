# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

## [1.0.1] - 2026-11-25

Fixes from a code review. Two of them tighten what is accepted; see Changed.

### Fixed

- A request target the URL parser rejects (`GET // HTTP/1.1`, `GET http://[`) no longer crashes
  the process; it gets a 404 or 400 error page. Only origin-form targets (`/path?query`) are
  routed
- Graceful shutdown: Puppeteer's own signal handlers are off under `serve`, so `SIGINT` (what PM2
  sends) no longer kills Chromium and exits mid-snapshot. The server stops accepting
  connections, finishes queued and in-flight snapshots, then closes Chromium. `SIGHUP` now shuts
  down the same way instead of closing Chromium under a running server
- Chromium is relaunched as soon as it crashes, retrying with backoff, so `/health` recovers
  without waiting for a snapshot request
- Requests refused by an active ban no longer count as strikes, so a banned client can't keep
  renewing its ban. An automatic ban never shortens a longer one, such as a manual `ban add`
- IPv6 addresses are compared in one spelling (`2001:db8:0:0::1` and `2001:db8::1` match), for
  bans, rate limits, exemptions and trusted proxies
- Blocked-request debug logs and unexpected-error logs no longer include URL query strings

### Changed

- An address range with an empty or non-numeric prefix (`10.0.0.0/`) in
  `WEBSNAPPER_TRUSTED_PROXIES` or `WEBSNAPPER_RATE_LIMIT_EXEMPT` is now a configuration error.
  It used to be read as `/0`, trusting or exempting every address in that family
- `WEBSNAPPER_MAX_WIDTH_PX` and `WEBSNAPPER_MAX_HEIGHT_PX` now apply to presets too. A preset over
  either limit is refused with 400 and left out of `/v1/viewports` and `websnapper viewports`.
  Nothing changes with the default limits
- `ecosystem.config.sample.cjs` waits 45 seconds before `SIGKILL` (was 30), and the systemd
  example's `TimeoutStopSec` is 45, to cover queue wait, page load and delay. Copy the new
  `kill_timeout` into an existing `ecosystem.config.cjs`

### Upgrading

- Check `WEBSNAPPER_TRUSTED_PROXIES` and `WEBSNAPPER_RATE_LIMIT_EXEMPT` for a `/` with nothing
  after it: the server now refuses to start until it is fixed (`websnapper config` lists problems)
- A manual IPv6 ban written in a long form before this release may not match; lift it and add it
  again

## [1.0.0] - 2026-11-25

First release.

### Added

- `GET /v1/snapshot`: PNG, JPEG or WebP snapshots by viewport preset, fixed size, or width with
  full rendered height. Failures return an HTML error page with a stable `X-Websnapper-Error`
  code, never an image
- `GET /v1/viewports` and `GET /health`
- One long-lived Chromium with a bounded pool of isolated browser contexts and a bounded queue
- Bearer-token authentication (default) or open mode
- URL policy: open, allow-list or block-list of regular expressions, applied to redirects, frames
  and (optionally) every subresource. `config/private-networks.txt` blocks private addresses
- Per-address rate limiting and automatic temporary bans, stored in SQLite
- `ecosystem.config.sample.cjs` for running under PM2
- `config/https-only.txt` rule template, blocking plain-HTTP URLs
- `bin/websnapper`: `serve`, `snap`, `viewports`, `key`, `rule`, `ban`, `db`, `doctor`, `config`
- Hourly housekeeping of expired bans

[Unreleased]: https://github.com/headwalluk/websnapper/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/headwalluk/websnapper/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/headwalluk/websnapper/releases/tag/v1.0.0
