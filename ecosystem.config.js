module.exports = {
  apps: [{
    name: 'vishva-erp',
    script: './backend/server.js',
    instances: 'max',
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_restarts: 10,
    restart_delay: 5000,
    kill_timeout: 10000,
    listen_timeout: 10000,
  }],
};
