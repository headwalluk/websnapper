# websnapper

![Node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen) ![Licence](https://img.shields.io/badge/licence-AGPL--3.0-blue)

A small REST service that returns screenshots of web pages. Ask for a URL; get back a PNG, JPEG
or WebP, or a plain error page with the right status code. A failed request never returns an image.

It keeps one headless Chromium running and renders each request in its own isolated browser
context, so snapshots are quick and don't share cookies or storage. Viewports can be a preset
(`desktop`, `tablet`, `iphone-11` and the rest of Puppeteer's device list), a fixed size, or a
width with the full rendered height.

It's built for homelabs and on-prem networks: bearer-token or open access, regex allow-lists or
block-lists for target URLs, per-address rate limiting with automatic temporary bans, and a
`bin/websnapper` command for keys, rules and bans instead of admin routes. One process, one
runtime dependency (`puppeteer-core`), SQLite through Node's built-in `node:sqlite`.

```
curl -H "Authorization: Bearer wsk_…" -o shot.png \
  "http://127.0.0.1:8490/v1/snapshot?url=https%3A%2F%2Fexample.com%2F&viewport=iphone-11"
```

## Documentation

Operators:

- [Getting started](docs/getting-started.md): install, first snapshot, first key
- [Configuration](docs/configuration.md): every setting and its default
- [Command line](docs/cli.md): `bin/websnapper` commands and exit codes
- [Deployment](docs/deployment.md): systemd, PM2, Nginx and Apache

API consumers:

- [HTTP API](docs/api.md): routes, parameters, viewports and error responses

Developers:

- [Development](docs/development.md): layout, request flow and design notes
- [Changelog](CHANGELOG.md)

## Licence

[GNU Affero General Public License v3.0](LICENSE). Copyright (c) 2026 Paul Faulkner.
