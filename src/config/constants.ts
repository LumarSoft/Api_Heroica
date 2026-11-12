export const CBU_DIGITOS = 22

// Los horarios de las tareas programadas se interpretan en hora de Argentina,
// sin depender de la zona horaria del servidor (el VPS corre la API en UTC).
export const OPCIONES_CRON = { timezone: 'America/Argentina/Buenos_Aires' }
