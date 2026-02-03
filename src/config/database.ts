import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Configuración del pool de conexiones a MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test de conexión
pool.getConnection()
  .then((connection) => {
    console.log('✅ Conectado a la base de datos MySQL');
    connection.release();
  })
  .catch((err) => {
    console.error('❌ Error al conectar a la base de datos:', err.message);
  });

// Función helper para ejecutar queries
export const query = async (sql: string, params?: any[]) => {
  const start = Date.now();
  try {
    const [results] = await pool.execute(sql, params);
    const duration = Date.now() - start;
    console.log('📊 Query ejecutada:', { sql: sql.substring(0, 50) + '...', duration });
    return results;
  } catch (error) {
    console.error('❌ Error en query:', error);
    throw error;
  }
};

// Función para obtener una conexión del pool (para transacciones)
export const getConnection = () => {
  return pool.getConnection();
};

export default pool;
