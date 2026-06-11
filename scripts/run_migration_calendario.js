/**
 * Migración Calendario RRHH: agrega la columna `periodicidad` a `rrhh_calendario_eventos`.
 * (Equivale a database/migrations/Calendario_refactor.sql · RH-61)
 *
 * Es idempotente: si la columna ya existe, no hace nada.
 * Ejecutar con: node scripts/run_migration_calendario.js
 */

require('dotenv').config()
const mysql = require('mysql2/promise')

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  })

  console.log(`✅ Conectado a la base de datos "${process.env.DB_DATABASE}"`)

  try {
    const [cols] = await connection.execute(
      `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'rrhh_calendario_eventos' AND COLUMN_NAME = 'periodicidad'
    `,
      [process.env.DB_DATABASE],
    )

    if (cols.length > 0) {
      console.log('ℹ️  La columna periodicidad ya existe. No se hace nada.')
      return
    }

    console.log('⏳ Agregando columna periodicidad a rrhh_calendario_eventos...')
    await connection.execute(`
      ALTER TABLE \`rrhh_calendario_eventos\`
        ADD COLUMN \`periodicidad\` varchar(50) DEFAULT NULL
          COMMENT 'Recurrencia del evento: Ninguna, Cada día, Lun-Vie, Cada semana, Cada 2 semanas, Cada mes, Primero de cada mes, Cada año'
          AFTER \`tipo_notion\`
    `)

    console.log('✅ Migración del calendario aplicada correctamente.')
  } catch (err) {
    console.error('❌ Error en migración:', err.message)
    process.exit(1)
  } finally {
    await connection.end()
  }
}

runMigration()
