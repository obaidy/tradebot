module.exports = {
  apps: [
    {
      name: 'client-runner',
      script: 'dist/workers/clientRunner.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        CLIENT_ID: process.env.CLIENT_ID || 'default',
        PG_URL: process.env.PG_URL,
        CLIENT_MASTER_KEY: process.env.CLIENT_MASTER_KEY,
        REDIS_URL: process.env.REDIS_URL,
        ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
      },
    },
  ],
};
