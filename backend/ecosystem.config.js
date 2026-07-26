module.exports = {
  apps: [{
    name: 'moviestream',
    script: 'server.js',
    cwd: '/var/www/moviestream/backend',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: '3001'
    },
    error_file: '/var/log/moviestream-error.log',
    out_file: '/var/log/moviestream-out.log',
    max_memory_restart: '400M',
    restart_delay: 3000,
    watch: false
  }]
};
