// pm2 process manager config for the Judge + Keeper services.
// Usage on server (from /var/www/ninjapact):
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save && pm2 startup   # persist across reboots
//
// Each service loads its own .env via dotenv (cwd-relative), so judge/.env and
// keeper/.env MUST exist on the server.
module.exports = {
  apps: [
    {
      name: 'np-judge',
      cwd: '/var/www/ninjapact/judge',
      script: './node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: 'none', // tsx is itself the executable
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'np-keeper',
      cwd: '/var/www/ninjapact/keeper',
      script: './node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: 'production' },
    },
  ],
}
