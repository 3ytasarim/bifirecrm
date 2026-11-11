// PM2 süreçleri — canlı sitenin süreçlerinden ayrı isimler ve port.
module.exports = {
  apps: [
    {
      name: "bifire-crm",
      cwd: "/var/www/bifire-crm",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3720 -H 127.0.0.1",
      env: { NODE_ENV: "production" },
      max_memory_restart: "700M",
      kill_timeout: 10000,
    },
    {
      name: "bifire-crm-worker",
      cwd: "/var/www/bifire-crm",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "--conditions=react-server scripts/worker.ts",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
      kill_timeout: 15000,
    },
  ],
};
