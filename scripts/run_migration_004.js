/**
 * Script de migración 004: Agrega columna movimiento_contraparte_id a movimientos.
 * Ejecutar con: node scripts/run_migration_004.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });

  console.log('✅ Conectado a la base de datos');

  try {
    // Verificar si la columna ya existe
    const [cols] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'movimientos' AND COLUMN_NAME = 'movimiento_contraparte_id'
    `, [process.env.DB_DATABASE]);

    if (cols.length > 0) {
      console.log('ℹ️  La columna movimiento_contraparte_id ya existe. No se hace nada.');
      return;
    }

    console.log('⏳ Agregando columna movimiento_contraparte_id...');
    await connection.execute(`
      ALTER TABLE \`movimientos\`
        ADD COLUMN \`movimiento_contraparte_id\` int DEFAULT NULL
          COMMENT 'ID del movimiento deuda espejo en la sucursal contraparte'
    `);

    console.log('⏳ Agregando índice...');
    await connection.execute(`
      ALTER TABLE \`movimientos\`
        ADD KEY \`idx_contraparte_id\` (\`movimiento_contraparte_id\`)
    `);

    console.log('⏳ Agregando foreign key...');
    await connection.execute(`
      ALTER TABLE \`movimientos\`
        ADD CONSTRAINT \`movimientos_ibfk_contraparte\`
          FOREIGN KEY (\`movimiento_contraparte_id\`) REFERENCES \`movimientos\` (\`id\`)
          ON DELETE SET NULL
    `);

    console.log('✅ Migración 004 aplicada correctamente.');
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

runMigration();
