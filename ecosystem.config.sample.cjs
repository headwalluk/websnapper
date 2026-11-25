// PM2 process file for websnapper. Copy to ecosystem.config.cjs (untracked), review, then:
//   pm2 start ecosystem.config.cjs && pm2 save
// Settings belong in .env; anything set under `env` here overrides it. See docs/deployment.md.
module.exports = {
  apps: [
    {
      name: 'websnapper',
      script: './bin/websnapper',
      args: 'serve',
      interpreter: 'node',
      cwd: __dirname,

      // One process owns one Chromium: never cluster or scale this app.
      exec_mode: 'fork',
      instances: 1,

      // Time to finish in-flight snapshots and close Chromium after SIGINT, before SIGKILL. Keep it
      // above WEBSNAPPER_QUEUE_TIMEOUT_MS + WEBSNAPPER_NAVIGATION_TIMEOUT_MS + WEBSNAPPER_MAX_DELAY_MS.
      kill_timeout: 45000,

      // Back off on crash loops (Chromium missing, port in use) instead of restarting instantly.
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '30s',

      // websnapper reloads URL rules itself; restarting on file changes would drop in-flight work.
      watch: false,

      // Uncomment to restart when Node's heap runs away. Chromium's memory is not counted.
      // max_memory_restart: '512M',

      time: true,
      merge_logs: true,
      // out_file: '/var/log/websnapper/out.log',
      // error_file: '/var/log/websnapper/error.log',

      env: {
        // Keep the env file somewhere other than the checkout, if you prefer:
        // WEBSNAPPER_ENV_FILE: '/etc/websnapper/websnapper.env',
      },
    },
  ],
};
