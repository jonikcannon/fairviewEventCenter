module.exports = {
  apps: [
    {
      name: 'fairviewApi',
      script: 'fairviewApi/server.js',
      cwd: '/var/www/fairview/app',
      env: {
        NODE_ENV: 'production',
        // Matches .env.example's PORT. Kept off 3000 deliberately: this app
        // is designed to run alongside sibling brand clones on the same
        // shared box (see the brandable-photo-commerce-starter skill), and
        // 3000 is the default a fresh clone's own PORT would fall back to,
        // so a second app hardcoding it here would collide on shared hosts.
        PORT: 3500
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      error_file: '/var/www/fairview/app/logs/pm2-error.log',
      out_file: '/var/www/fairview/app/logs/pm2-out.log',
      merge_logs: true,
      time: true
    }
  ]
};
