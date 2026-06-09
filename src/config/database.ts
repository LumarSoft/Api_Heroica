import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

// Configuración del pool de conexiones a MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  // Configurable por env para escalar sin tocar código (default 10)
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
  queueLimit: 0,
})

// Test de conexión
pool
  .getConnection()
  .then(connection => {
    console.log('✅ Conectado a la base de datos MySQL')
    connection.release()
  })
  .catch(err => {
    console.error('❌ Error al conectar a la base de datos:', err.message)
  })

// Umbral para loguear queries lentas (ms)
const SLOW_QUERY_MS = parseInt(process.env.SLOW_QUERY_MS || '200')
const isProd = process.env.NODE_ENV === 'production'

// Función helper para ejecutar queries
export const query = async (sql: string, params?: any[]) => {
  const start = Date.now()
  try {
    const [results] = await pool.execute(sql, params)
    const duration = Date.now() - start
    // En producción solo se loguean queries lentas (reduce ruido y costo de I/O)
    if (!isProd || duration >= SLOW_QUERY_MS) {
      console.log(`📊 Query ${duration >= SLOW_QUERY_MS ? 'LENTA ' : ''}(${duration}ms):`, sql.substring(0, 80))
    }
    return results
  } catch (error) {
    console.error('❌ Error en query:', error)
    throw error
  }
}

// Función para obtener una conexión del pool (para transacciones)
export const getConnection = () => {
  return pool.getConnection()
}

/**
 * Ejecuta un callback dentro de una transacción MySQL.
 * Commit si resuelve, rollback si lanza. Libera la conexión siempre.
 *
 * Uso:
 *   await withTransaction(async conn => {
 *     await conn.execute('UPDATE ... WHERE id = ?', [id])
 *     await conn.execute('INSERT INTO ...', [...])
 *   })
 */
export const withTransaction = async <T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> => {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}

export default pool
