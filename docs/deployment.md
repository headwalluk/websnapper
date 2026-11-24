# Deployment

For operators. websnapper is one Node process owning one Chromium. Run a single instance:
there is nothing to gain from clustering, since Chromium does the work and each instance would
start its own.

## systemd

`/etc/systemd/system/websnapper.service`:

```ini
[Unit]
Description=websnapper
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=websnapper
Group=websnapper
WorkingDirectory=/opt/websnapper
Environment=WEBSNAPPER_ENV_FILE=/etc/websnapper/websnapper.env
ExecStart=/usr/bin/node /opt/websnapper/bin/websnapper serve
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Use an absolute `WEBSNAPPER_DATABASE_PATH` in the env file (for example
`/var/lib/websnapper/websnapper.sqlite`) and make it writable by the service user. Don't add
`ProtectHome` or a seccomp filter without checking that Chromium still starts: its sandbox needs
user namespaces.

```
sudo systemctl daemon-reload && sudo systemctl enable --now websnapper
journalctl -u websnapper -f
```

## PM2

```
pm2 start bin/websnapper --name websnapper --interpreter node -- serve
```

Fork mode, one instance.

## Behind Nginx

```nginx
location /websnapper/ {
    proxy_pass http://127.0.0.1:8490/;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 60s;
}
```

Set `WEBSNAPPER_TRUSTED_PROXIES='127.0.0.1'`. Setting `X-Forwarded-For` to `$remote_addr`
(rather than appending) stops clients supplying their own.

## Behind Apache

```apache
ProxyPass        /websnapper/ http://127.0.0.1:8490/
ProxyPassReverse /websnapper/ http://127.0.0.1:8490/
ProxyTimeout 60
```

`mod_proxy_http` appends the client address to `X-Forwarded-For`; set
`WEBSNAPPER_TRUSTED_PROXIES='127.0.0.1'`.

## Exposed beyond the LAN

- Keep `WEBSNAPPER_AUTH_MODE='token'`
- Use `block-list` with `config/private-networks.txt`, or an `allow-list`, so the service can't be
  used to look inside your network. Rules match URLs, not resolved addresses: a public host name
  pointing at a private address gets through
- Keep `WEBSNAPPER_HOST='127.0.0.1'` and let the proxy terminate TLS

## Upgrading

```
git pull && npm ci && npm run build
./bin/websnapper db migrate
sudo systemctl restart websnapper
```
