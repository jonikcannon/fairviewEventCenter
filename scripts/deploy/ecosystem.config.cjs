module.exports = {
  apps: [
    {
      name: 'fairviewApi',
      script: 'fairviewApi/server.js',
      cwd: '/var/www/fairview/app',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
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
