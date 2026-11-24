# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

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
- `bin/websnapper`: `serve`, `snap`, `viewports`, `key`, `rule`, `ban`, `db`, `doctor`, `config`
- Hourly housekeeping of expired bans
