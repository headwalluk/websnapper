# websnapper

Repository: public

A small REST service that returns screenshots of web pages, rendered by a single long-lived
headless Chromium. Designed for homelab and on-prem use, optionally behind a reverse proxy.

House style: the headwall-node-ts skill.

## Commands

- `npm run check`: typecheck, lint, tests (the browser test needs `/usr/bin/chromium`)
- `npm run websnapper -- <command>`: the CLI from source
- `npm run build`: compile to `dist/` for `bin/websnapper`

## Architecture

One process, one Chromium, a pool of `BrowserContext`s. `src/services/snapshot-service.ts` is
the pipeline shared by `src/http/server.ts` and the `snap` command. Keys, URL rules and bans
live in SQLite (`node:sqlite`); the server reloads rules when `PRAGMA data_version` changes.
See `docs/development.md` for the request flow and design notes.

Runtime dependencies: `puppeteer-core` only.

Design history and decisions are in `dev-notes/` (untracked).
