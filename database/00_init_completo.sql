-- =====================================================
-- SCRIPT MAESTRO DE INICIALIZACIÓN
-- Ejecuta todos los scripts en el orden correcto
-- =====================================================

-- IMPORTANTE: Ejecutar este script completo en tu cliente MySQL
-- O ejecutar los archivos individuales en este orden:

-- 1. Primero crear la tabla de pagos pendientes
-- source crear_tabla_pagos_pendientes.sql

-- 2. Luego crear la tabla de movimientos banco
-- source crear_tabla_movimientos_caja_banco.sql

-- 3. Finalmente actualizar movimientos efectivo
-- source actualizar_movimientos_efectivo.sql

-- =====================================================
-- O EJECUTAR TODO JUNTO AQUÍ:
-- =====================================================

-- ========== PASO 1: PAGOS PENDIENTES ==========
CREATE TABLE IF NOT EXISTS pagos_pendientes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sucursal_id INT NOT NULL,
  usuario_creador_id INT NOT NULL,
  
  -- Información del pago
  fecha_solicitud DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_pago_programada DATE NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  descripcion TEXT,
  monto DECIMAL(15,2) NOT NULL,
  proveedor VARCHAR(255),
  
  -- Clasificación
  tipo_caja ENUM('efectivo', 'banco') NOT NULL,
  prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
  estado ENUM('pendiente', 'aprobado', 'rechazado') DEFAULT 'pendiente',
  
  -- Información de revisión
  motivo_rechazo TEXT,
  usuario_revisor_id INT,
  fecha_revision DATETIME,
  
  -- Relación con movimiento creado (cuando se aprueba)
  movimiento_id INT,
  
  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Foreign Keys
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_creador_id) REFERENCES usuarios(id),
  FOREIGN KEY (usuario_revisor_id) REFERENCES usuarios(id),
  
  -- Índices para mejorar rendimiento
  INDEX idx_sucursal_estado (sucursal_id, estado),
  INDEX idx_fecha_solicitud (fecha_solicitud),
  INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== PASO 2: MOVIMIENTOS CAJA BANCO ==========
CREATE TABLE IF NOT EXISTS movimientos_caja_banco (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sucursal_id INT NOT NULL,
  
  -- Información del movimiento
  fecha DATE NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  descripcion TEXT,
  monto DECIMAL(15,2) NOT NULL,
  
  -- Clasificación
  tipo_movimiento ENUM('saldo_real', 'saldo_necesario') NOT NULL,
  estado ENUM('pendiente', 'aprobado', 'rechazado', 'completado') DEFAULT 'pendiente',
  prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
  
  -- Campos específicos de banco
  numero_cheque VARCHAR(50),
  banco VARCHAR(100),
  cuenta VARCHAR(50),
  cbu VARCHAR(22),
  tipo_operacion ENUM('transferencia', 'cheque', 'debito', 'credito', 'otro'),
  
  -- Relación con pago pendiente (si aplica)
  pago_pendiente_id INT,
  
  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Foreign Keys
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (pago_pendiente_id) REFERENCES pagos_pendientes(id) ON DELETE SET NULL,
  
  -- Índices
  INDEX idx_sucursal_tipo (sucursal_id, tipo_movimiento),
  INDEX idx_fecha (fecha),
  INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== PASO 3: ACTUALIZAR MOVIMIENTOS EFECTIVO ==========
-- Verificar si la columna ya existe
SET @column_exists = (
  SELECT COUNT(*) 
  FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'movimientos_caja_efectivo' 
  AND COLUMN_NAME = 'pago_pendiente_id'
);

-- Solo agregar si no existe
SET @sql = IF(@column_exists = 0,
  'ALTER TABLE movimientos_caja_efectivo ADD COLUMN pago_pendiente_id INT',
  'SELECT "La columna pago_pendiente_id ya existe" AS mensaje'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Agregar foreign key si no existe
SET @fk_exists = (
  SELECT COUNT(*) 
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
  WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'movimientos_caja_efectivo' 
  AND CONSTRAINT_NAME = 'fk_movimiento_pago_pendiente'
);

SET @sql_fk = IF(@fk_exists = 0,
  'ALTER TABLE movimientos_caja_efectivo ADD CONSTRAINT fk_movimiento_pago_pendiente FOREIGN KEY (pago_pendiente_id) REFERENCES pagos_pendientes(id) ON DELETE SET NULL',
  'SELECT "El foreign key fk_movimiento_pago_pendiente ya existe" AS mensaje'
);

PREPARE stmt FROM @sql_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Agregar índice si no existe
SET @idx_exists = (
  SELECT COUNT(*) 
  FROM INFORMATION_SCHEMA.STATISTICS 
  WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'movimientos_caja_efectivo' 
  AND INDEX_NAME = 'idx_pago_pendiente'
);

SET @sql_idx = IF(@idx_exists = 0,
  'ALTER TABLE movimientos_caja_efectivo ADD INDEX idx_pago_pendiente (pago_pendiente_id)',
  'SELECT "El índice idx_pago_pendiente ya existe" AS mensaje'
);

PREPARE stmt FROM @sql_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- VERIFICACIÓN FINAL
-- =====================================================
SELECT 'Tablas creadas/actualizadas exitosamente!' AS resultado;

-- Verificar tablas
SHOW TABLES LIKE '%pago%';
SHOW TABLES LIKE '%banco%';

-- Verificar estructura de movimientos_caja_efectivo
DESCRIBE movimientos_caja_efectivo;
