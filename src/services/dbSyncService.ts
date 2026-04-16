import cron from 'node-cron'
import pool from '../config/database'

// Esta función realiza la sincronización mediante consultas SQL directas.
const syncDatabase = async () => {
  const connection = await pool.getConnection()

  console.log('⏱️ Iniciando sincronización de base de datos oficial a base de pruebas...')
  const start = Date.now()

  try {
    // 1. Desactivar validación de llaves foráneas para poder recrear tablas
    await connection.query('SET FOREIGN_KEY_CHECKS = 0;')

    // 2. Obtener todas las tablas de heroica_oficial
    const [rows]: any = await connection.query('SHOW TABLES FROM heroica_oficial;')
    const tables = rows.map((row: any) => Object.values(row)[0] as string)

    for (const table of tables) {
      // 3. Eliminar la tabla en pruebas si existe, recrearla con la misma estructura e insertar los datos
      await connection.query(`DROP TABLE IF EXISTS heroica_prueba.\`${table}\`;`)
      await connection.query(`CREATE TABLE heroica_prueba.\`${table}\` LIKE heroica_oficial.\`${table}\`;`)
      await connection.query(`INSERT INTO heroica_prueba.\`${table}\` SELECT * FROM heroica_oficial.\`${table}\`;`)
    }

    // 4. Reactivar llaves foráneas
    await connection.query('SET FOREIGN_KEY_CHECKS = 1;')

    const duration = Date.now() - start
    console.log(`✅ Sincronización exitosa. Se copiaron ${tables.length} tablas en ${duration}ms.`)
  } catch (error: any) {
    console.error('❌ Error durante la sincronización de las bases de datos:', error.message)
    // En caso de error, siempre re-activar foreign key checks
    await connection.query('SET FOREIGN_KEY_CHECKS = 1;').catch(() => {})
  } finally {
    connection.release()
  }
}

// Programar la tarea para que se ejecute a las 06:00 AM y 18:00 PM todos los días.
// Formato cron: "0 6,18 * * *" => A las 06:00 y 18:00 todos los días.
export const startDbSyncCron = () => {
  cron.schedule('0 6,18 * * *', () => {
    syncDatabase()
  })
  console.log('📅 Tarea programada (CRON): Sincronización de BD diaria (06:00 y 18:00).')

  // Ejecutar al levantar la API por primera vez
  syncDatabase()
}

// También podemos exportar la función si en algún momento se quiere forzar la sync manual
export { syncDatabase }
