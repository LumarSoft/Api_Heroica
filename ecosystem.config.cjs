// PM2 — API de Heroica en el VPS de Lumarsoft.
// Los secretos (base, JWT, Resend, Blob) van en /root/api-heroica/.env, no acá.
// Lo que se define acá le gana al .env, porque dotenv no pisa variables que ya existen.
module.exports = {
  apps: [
    {
      name: 'heroica_api',
      cwd: '/root/api-heroica',
      script: 'dist/index.js',
      interpreter: '/root/.nvm/versions/node/v22.23.2/bin/node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        // Vercel corre en UTC y el servidor en hora argentina: se fija UTC para que las fechas se comporten igual.
        TZ: 'UTC',
        PORT: '3006',
        // Solo acepta conexiones locales: el tráfico entra por nginx.
        HOST: '127.0.0.1',
        TRUST_PROXY: '1',
        // Los archivos se guardan en uploads/ (enlace a /var/lib/heroica/uploads).
        STORAGE_DRIVER: 'local',
        // Apagadas mientras la API de Vercel siga activa, para no duplicar sincronización ni emails.
        // Al hacer el traspaso: quitar esta línea y reiniciar con `pm2 restart heroica_api --update-env`.
        CRONS_DISABLED: 'true',
      },
    },
  ],
}
