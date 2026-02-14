-- =====================================================
-- SCRIPT MAESTRO COMPLETO - VERSIÓN 2.0
-- Sistema de Gestión de Cajas con Configuración
-- =====================================================

-- EJECUTAR EN ESTE ORDEN:
-- 1. source 01_tablas_configuracion.sql
-- 2. source 00_init_completo.sql (si no se ejecutó antes)
-- 3. source 02_actualizar_tablas.sql

-- O EJECUTAR TODO JUNTO DESDE AQUÍ

-- =====================================================
-- PASO 1: TABLAS DE CONFIGURACIÓN
-- =====================================================

-- Categorías
CREATE TABLE IF NOT EXISTS categorias (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Subcategorías
CREATE TABLE IF NOT EXISTS subcategorias (
  id INT PRIMARY KEY AUTO_INCREMENT,
  categoria_id INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE CASCADE,
  INDEX idx_categoria (categoria_id),
  INDEX idx_activo (activo),
  UNIQUE KEY unique_subcategoria (categoria_id, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bancos
CREATE TABLE IF NOT EXISTS bancos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  codigo VARCHAR(10),
  activo BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Medios de Pago
CREATE TABLE IF NOT EXISTS medios_pago (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Datos iniciales
INSERT INTO categorias (nombre, descripcion) VALUES
('Servicios', 'Gastos de servicios básicos'),
('Sueldos', 'Pagos de sueldos y salarios'),
('Proveedores', 'Pagos a proveedores'),
('Impuestos', 'Pagos de impuestos y tasas'),
('Mantenimiento', 'Gastos de mantenimiento'),
('Otros', 'Otros gastos')
ON DUPLICATE KEY UPDATE nombre=nombre;

INSERT INTO subcategorias (categoria_id, nombre, descripcion) VALUES
(1, 'Luz', 'Servicio eléctrico'),
(1, 'Agua', 'Servicio de agua'),
(1, 'Gas', 'Servicio de gas'),
(1, 'Internet', 'Servicio de internet'),
(2, 'Sueldos Personal', 'Sueldos del personal'),
(2, 'Cargas Sociales', 'Cargas sociales'),
(3, 'Mercadería', 'Compra de mercadería'),
(3, 'Insumos', 'Compra de insumos'),
(4, 'IVA', 'Impuesto al Valor Agregado'),
(4, 'Ganancias', 'Impuesto a las Ganancias'),
(5, 'Reparaciones', 'Reparaciones varias'),
(5, 'Limpieza', 'Servicios de limpieza')
ON DUPLICATE KEY UPDATE nombre=nombre;

INSERT INTO bancos (nombre, codigo) VALUES
('Banco Nación', 'BNA'),
('Banco Provincia', 'BAPRO'),
('Banco Galicia', 'GALI'),
('Banco Santander', 'SANT'),
('Banco BBVA', 'BBVA'),
('Banco Macro', 'MACRO'),
('Banco ICBC', 'ICBC'),
('Mercado Pago', 'MP'),
('Brubank', 'BRUN'),
('Otro', 'OTRO')
ON DUPLICATE KEY UPDATE nombre=nombre;

INSERT INTO medios_pago (nombre, descripcion) VALUES
('Transferencia', 'Transferencia bancaria'),
('Cheque', 'Pago con cheque'),
('Débito Automático', 'Débito automático de cuenta'),
('Tarjeta de Crédito', 'Pago con tarjeta de crédito'),
('Tarjeta de Débito', 'Pago con tarjeta de débito'),
('Efectivo', 'Pago en efectivo'),
('Otro', 'Otro medio de pago')
ON DUPLICATE KEY UPDATE nombre=nombre;

-- =====================================================
-- PASO 2: PAGOS PENDIENTES (si no existe)
-- =====================================================

CREATE TABLE IF NOT EXISTS pagos_pendientes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sucursal_id INT NOT NULL,
  usuario_creador_id INT NOT NULL,
  fecha_solicitud DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_pago_programada DATE NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  descripcion TEXT,
  monto DECIMAL(15,2) NOT NULL,
  proveedor VARCHAR(255),
  tipo_caja ENUM('efectivo', 'banco') NOT NULL,
  prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
  estado ENUM('pendiente', 'aprobado', 'rechazado') DEFAULT 'pendiente',
  motivo_rechazo TEXT,
  usuario_revisor_id INT,
  fecha_revision DATETIME,
  movimiento_id INT,
  categoria_id INT,
  subcategoria_id INT,
  banco_id INT,
  medio_pago_id INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_creador_id) REFERENCES usuarios(id),
  FOREIGN KEY (usuario_revisor_id) REFERENCES usuarios(id),
  FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL,
  FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id) ON DELETE SET NULL,
  FOREIGN KEY (banco_id) REFERENCES bancos(id) ON DELETE SET NULL,
  FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id) ON DELETE SET NULL,
  INDEX idx_sucursal_estado (sucursal_id, estado),
  INDEX idx_fecha_solicitud (fecha_solicitud),
  INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- PASO 3: MOVIMIENTOS CAJA BANCO (si no existe)
-- =====================================================

CREATE TABLE IF NOT EXISTS movimientos_caja_banco (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sucursal_id INT NOT NULL,
  fecha DATE NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  descripcion TEXT,
  monto DECIMAL(15,2) NOT NULL,
  tipo_movimiento ENUM('saldo_real', 'saldo_necesario') NOT NULL,
  estado ENUM('pendiente', 'aprobado', 'rechazado', 'completado') DEFAULT 'pendiente',
  prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
  numero_cheque VARCHAR(50),
  cuenta VARCHAR(50),
  cbu VARCHAR(22),
  pago_pendiente_id INT,
  categoria_id INT,
  subcategoria_id INT,
  usuario_creador_id INT,
  banco_id INT,
  medio_pago_id INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (pago_pendiente_id) REFERENCES pagos_pendientes(id) ON DELETE SET NULL,
  FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL,
  FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id) ON DELETE SET NULL,
  FOREIGN KEY (usuario_creador_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  FOREIGN KEY (banco_id) REFERENCES bancos(id) ON DELETE SET NULL,
  FOREIGN KEY (medio_pago_id) REFERENCES medios_pago(id) ON DELETE SET NULL,
  INDEX idx_sucursal_tipo (sucursal_id, tipo_movimiento),
  INDEX idx_fecha (fecha),
  INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- PASO 4: ACTUALIZAR TABLAS EXISTENTES
-- =====================================================

-- Actualizar sucursales (email y documentación)
SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'sucursales' 
  AND COLUMN_NAME = 'email_correspondencia'
);

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE sucursales ADD COLUMN email_correspondencia VARCHAR(255), ADD COLUMN documentacion_path VARCHAR(500), ADD COLUMN documentacion_nombre VARCHAR(255)',
  'SELECT "Columnas de sucursales ya existen" AS mensaje'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Actualizar movimientos_caja_efectivo (categorías y usuario)
SET @column_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() 
  AND TABLE_NAME = 'movimientos_caja_efectivo' 
  AND COLUMN_NAME = 'categoria_id'
);

SET @sql = IF(@column_exists = 0,
  'ALTER TABLE movimientos_caja_efectivo 
   ADD COLUMN categoria_id INT,
   ADD COLUMN subcategoria_id INT,
   ADD COLUMN usuario_creador_id INT,
   ADD FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE SET NULL,
   ADD FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id) ON DELETE SET NULL,
   ADD FOREIGN KEY (usuario_creador_id) REFERENCES usuarios(id) ON DELETE SET NULL',
  'SELECT "Columnas de movimientos_caja_efectivo ya existen" AS mensaje'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- =====================================================
-- VERIFICACIÓN FINAL
-- =====================================================
SELECT '✅ Base de datos actualizada completamente!' AS resultado;
SELECT COUNT(*) as categorias FROM categorias;
SELECT COUNT(*) as subcategorias FROM subcategorias;
SELECT COUNT(*) as bancos FROM bancos;
SELECT COUNT(*) as medios_pago FROM medios_pago;
