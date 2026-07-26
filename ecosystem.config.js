module.exports = {
  apps: [{
    name: 'moviestream',
    cwd: './backend',
    script: 'server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    time: true
  }]
};
