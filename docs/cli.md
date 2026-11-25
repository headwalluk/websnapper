# Command line

For operators. `bin/websnapper` manages keys, URL rules and bans, takes local snapshots and runs
the server. It works on the same database and settings as the server, and never calls the HTTP API.

In a development checkout, run it as `npm run websnapper -- <command>`.

Every command accepts `--json` (one JSON object on stdout) and `--help`.

## Server

| Command | Does |
|---|---|
| `websnapper serve` | Runs the server until SIGINT, SIGTERM or SIGHUP, then finishes in-flight snapshots and closes Chromium. Refuses to start while migrations are pending |
| `websnapper doctor` | Checks the config, database, migrations, keys, rules and that Chromium launches |
| `websnapper config` | Prints the effective configuration |
| `websnapper db migrate` | Creates or upgrades the database schema. Run after install and after every upgrade |
| `websnapper db status` | Lists pending migrations |

## Snapshots

```
websnapper snap <url> --output <file|-> [--viewport <slug> | --width <px> [--height <px>]] [--full]
                [--format png|jpeg|webp] [--quality 1-100] [--wait load|networkidle] [--delay-ms <ms>]
```

Takes a snapshot through the same code the server uses (URL policy included), launching its own
Chromium. `--output -` writes the image to stdout. A failure writes no file.

`websnapper viewports` lists the presets that fit the configured size limits.

## API keys

| Command | Does |
|---|---|
| `websnapper key create --label <text>` | Mints a key and prints its token **once**. Only a hash is stored |
| `websnapper key list` | Lists keys with created, last-used and revoked times |
| `websnapper key revoke <id> [--yes]` | Revokes a key at once; the running server sees it on the next request |

## URL rules

Rules are JavaScript regular expressions matched against the full, normalised URL
(`https://example.com/path?query`, lower-case scheme and host). Whether a match allows or blocks
depends on `WEBSNAPPER_URL_POLICY`. The server picks up changes without a restart.

| Command | Does |
|---|---|
| `websnapper rule add '<pattern>' [--note <text>]` | Adds a rule. An invalid pattern is refused |
| `websnapper rule list` | Lists rules and the current policy mode |
| `websnapper rule remove <id> [--yes]` | Removes a rule |
| `websnapper rule test <url>` | Says whether the policy allows the URL and which rule matched. Exits 4 when blocked |
| `websnapper rule import <file>` | Adds every pattern in a file (one per line; a `#` line just above a pattern is its note). Duplicates are skipped; an invalid line aborts the whole import |
| `websnapper rule export` | Prints the rules in the format `import` reads |

`config/` holds rule templates for `WEBSNAPPER_URL_POLICY=block-list`. Import any combination;
each one adds to the rules already there:

| Template | Blocks |
|---|---|
| `config/private-networks.txt` | Loopback, private and link-local addresses, and local-only host names |
| `config/https-only.txt` | Every `http://` URL: targets, redirects to plain HTTP and, with scope `all`, plain-HTTP subresources |

```
websnapper rule import config/private-networks.txt
websnapper rule import config/https-only.txt
```

To drop a template later, find its rules with `rule list` and `rule remove` them.

Rules see the URL, not the address a host name resolves to: a public host name pointing at a
private address is not caught.

## Bans

| Command | Does |
|---|---|
| `websnapper ban list` | Lists active bans |
| `websnapper ban lift <ip>` | Lifts a ban now |
| `websnapper ban add <ip> [--minutes <n>]` | Bans an address (default 60 minutes) |

Bans lift themselves when they expire. The server deletes expired rows hourly.

## Destructive commands

`key revoke` and `rule remove` ask for confirmation on a terminal. Elsewhere (scripts, cron) they
refuse with exit code 4 unless given `--yes`.

## Exit codes

| Code | Name | Meaning |
|---|---|---|
| 0 | `success` | |
| 1 | `failure` | The command ran and something went wrong (target unreachable, no such key) |
| 2 | `usage` | Unknown command, missing or invalid arguments, invalid snapshot parameters |
| 3 | `invalidConfig` | Configuration problems, every one listed |
| 4 | `refused` | Needs `--yes`, or the URL policy blocks the URL |
| 5 | `notReady` | Migrations are pending, or no browser slot was free |
