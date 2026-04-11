import pool from '../src/config/database';

async function migrate() {
  try {
    const connection = await pool.getConnection();
    
    console.log('Creando tabla descripciones...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS descripciones (
        id INT NOT NULL AUTO_INCREMENT,
        nombre VARCHAR(255) NOT NULL,
        activo TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('Creando tabla proveedores...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS proveedores (
        id INT NOT NULL AUTO_INCREMENT,
        nombre VARCHAR(255) NOT NULL,
        activo TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('Renombrando descripcion a comentarios en movimientos...');
    try {
      await connection.query(`ALTER TABLE movimientos CHANGE descripcion comentarios TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    } catch (e: any) {
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        console.log('Columna descripcion ya fue renombrada a comentarios.');
      } else {
        throw e;
      }
    }

    console.log('Agregando descripcion_id a movimientos...');
    try {
      await connection.query(`ALTER TABLE movimientos ADD COLUMN descripcion_id INT DEFAULT NULL;`);
      await connection.query(`ALTER TABLE movimientos ADD CONSTRAINT fk_movimientos_descripcion FOREIGN KEY (descripcion_id) REFERENCES descripciones(id) ON DELETE SET NULL;`);
    } catch (e: any) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('Columna descripcion_id ya existe.');
      } else {
        throw e;
      }
    }

    console.log('Agregando proveedor_id a movimientos...');
    try {
      await connection.query(`ALTER TABLE movimientos ADD COLUMN proveedor_id INT DEFAULT NULL;`);
      await connection.query(`ALTER TABLE movimientos ADD CONSTRAINT fk_movimientos_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL;`);
    } catch (e: any) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log('Columna proveedor_id ya existe.');
      } else {
        throw e;
      }
    }

    console.log('Eliminando columna proveedor original si existe...');
    try {
      await connection.query(`ALTER TABLE movimientos DROP COLUMN proveedor;`);
    } catch (e: any) {
      console.log('Columna proveedor no existe o ya fue eliminada.');
    }

    connection.release();
    console.log('Migración completada exitosamente.');
    process.exit(0);
  } catch (error) {
    console.error('Error en migración:', error);
    process.exit(1);
  }
}

migrate();
