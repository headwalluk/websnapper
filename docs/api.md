# HTTP API

For API consumers: the routes, their parameters and every response websnapper can give.

All routes are `GET`. Every response carries `Cache-Control: no-store`.

## Authentication

In `token` mode (the default), `/v1/*` routes need a bearer token minted with
`websnapper key create`:

```
Authorization: Bearer wsk_…
```

In `open` mode no header is needed. `/health` never needs one.

## `GET /v1/snapshot`

Renders a page and returns the image.

| Parameter | Values | Default |
|---|---|---|
| `url` | absolute `http` or `https` URL, percent-encoded | required |
| `viewport` | a preset slug from `/v1/viewports` | `desktop`, unless `width` is given |
| `width` | CSS pixels, 1 to the configured maximum | from the preset |
| `height` | CSS pixels, 1 to the configured maximum | from the preset |
| `full` | `1` to capture the full rendered height, `0` for the viewport only | `0` |
| `format` | `png`, `jpeg` or `webp` | the server's default (PNG unless changed) |
| `quality` | 1 to 100, `jpeg` and `webp` only | the server's default (80 unless changed) |
| `wait` | `load` (the load event) or `networkidle` (no more than 2 connections for 500 ms) | `load` |
| `delay_ms` | extra wait after the page is ready, up to the configured maximum | `0` |

Rules:

- Give `viewport`, or `width` with `height`, or `width` with `full=1`. Not both kinds
- `full=1` also works with a preset: the preset's width, the page's full height
- Device presets (`iphone-11`, `ipad-pro`, `pixel-5`, …) set the device's user agent, touch
  and pixel ratio, so `iphone-11` returns an 828×1656 image (414×828 at 2×)
- Full-page captures are cut off at the server's maximum height
- Unknown or repeated parameters are refused with 400

Examples:

```
/v1/snapshot?url=https%3A%2F%2Fexample.com%2F
/v1/snapshot?url=https%3A%2F%2Fexample.com%2F&viewport=iphone-11&format=webp
/v1/snapshot?url=https%3A%2F%2Fexample.com%2F&width=1280&full=1
/v1/snapshot?url=https%3A%2F%2Fexample.com%2F&width=1024&height=768&format=jpeg&quality=70
```

### Success

`200` with the image as the body, `Content-Type` `image/png`, `image/jpeg` or `image/webp`, and:

| Header | Meaning |
|---|---|
| `X-Websnapper-Final-Url` | the URL after redirects |
| `X-Websnapper-Upstream-Status` | the status the target answered with |
| `X-Websnapper-Render-Ms` | time spent waiting for a slot and rendering |

## `GET /v1/viewports`

JSON: `{ "viewports": [ { "slug", "label", "width", "height", "deviceScaleFactor", "isMobile", "hasTouch", "isLandscape", "userAgent" } ] }`.

## `GET /health`

`200 ok` when Chromium is running, `503` otherwise. No authentication. Still subject to rate
limits and bans unless the caller's address is exempt.

## Errors

A failed request **never** returns an image. It returns a short HTML page:

```html
<!doctype html>
<title>502 Bad Gateway</title>
<h1>502 Bad Gateway</h1>
<p>Target returned 404 Not Found.</p>
```

with `Content-Type: text/html; charset=utf-8` and an `X-Websnapper-Error` header holding a
stable code. Scripts should branch on the status or that header, never on the message text.

| Status | `X-Websnapper-Error` | When |
|---|---|---|
| 400 | `invalid_request` | a parameter is missing, unknown, repeated or out of range (every problem is listed) |
| 401 | `unauthorised` | token mode, and the bearer token is missing, unknown or revoked. Sent with `WWW-Authenticate: Bearer` |
| 403 | `url_blocked` | the URL policy refuses the target, or the target redirected somewhere it refuses |
| 404 | `not_found` | no such route |
| 405 | `method_not_allowed` | anything but `GET`. Sent with `Allow: GET` |
| 429 | `rate_limited` | too many requests, or the address is temporarily banned. Sent with `Retry-After` |
| 500 | `internal_error` | something unexpected; details are in the server log |
| 502 | `upstream_error` | the target answered 4xx/5xx (status in `X-Websnapper-Upstream-Status`), or could not be reached (DNS, connection, TLS) |
| 503 | `unavailable` | every browser slot is busy and the queue is full, or the wait for a slot timed out. Sent with `Retry-After` |
| 504 | `upstream_timeout` | the target didn't finish loading in time |

A target's own error status is reported as 502, not passed through, so a target's 401 or 429
can't be mistaken for websnapper's own.

### Bans

Requests that fail with 400, 401, 403, 404, 405 or 429 count as strikes against the client
address. Too many inside the window bans the address for a while (see
[configuration](configuration.md#rate-limiting-and-bans)); every request from it then gets 429
until the ban expires.
