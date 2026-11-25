# Getting started

For operators: install, configure and take a first snapshot.

## Requirements

- Linux with Node.js 22.13 or later (24 LTS recommended)
- Chromium from your distribution: `sudo apt install chromium`
- Fonts, for pages to render properly: `sudo apt install fonts-noto fonts-noto-color-emoji`
- A non-root user to run it as. Chromium's sandbox stays on and needs unprivileged user namespaces,
  which Debian and Ubuntu enable by default

## Install

```
git clone https://github.com/headwalluk/websnapper.git && cd websnapper
npm ci
npm run build
cp .env.sample .env        # then edit
./bin/websnapper db migrate
./bin/websnapper doctor
```

## First snapshot

```
./bin/websnapper snap https://example.com/ --output example.png
```

## Run the server

```
./bin/websnapper key create --label my-dashboard     # copy the token it prints
./bin/websnapper serve
```

From another shell:

```
curl -H "Authorization: Bearer wsk_…" \
  -o example.png "http://127.0.0.1:8490/v1/snapshot?url=https%3A%2F%2Fexample.com%2F&viewport=iphone-11"
```

To run without tokens, set `WEBSNAPPER_AUTH_MODE='open'` in `.env`.

Next: [deployment](deployment.md) for systemd, PM2 and reverse proxies, [configuration](configuration.md)
for every setting, the [API](api.md) and the [CLI](cli.md).
