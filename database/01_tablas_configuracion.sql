-- =====================================================
-- TABLAS DE CONFIGURACIÓN AUTOADMINISTRABLES
-- =====================================================

-- ========== CATEGORÍAS ==========
CREATE TABLE IF NOT EXISTS categorias (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== SUBCATEGORÍAS ==========
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

-- ========== BANCOS ==========
CREATE TABLE IF NOT EXISTS bancos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  codigo VARCHAR(10),
  activo BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== MEDIOS DE PAGO ==========
CREATE TABLE IF NOT EXISTS medios_pago (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== DATOS INICIALES ==========

-- Categorías por defecto
INSERT INTO categorias (nombre, descripcion) VALUES
('Servicios', 'Gastos de servicios básicos'),
('Sueldos', 'Pagos de sueldos y salarios'),
('Proveedores', 'Pagos a proveedores'),
('Impuestos', 'Pagos de impuestos y tasas'),
('Mantenimiento', 'Gastos de mantenimiento'),
('Otros', 'Otros gastos')
ON DUPLICATE KEY UPDATE nombre=nombre;

-- Subcategorías por defecto
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

-- Bancos por defecto
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

-- Medios de pago por defecto
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
-- VERIFICACIÓN
-- =====================================================
SELECT 'Tablas de configuración creadas exitosamente!' AS resultado;
SELECT COUNT(*) as total_categorias FROM categorias;
SELECT COUNT(*) as total_subcategorias FROM subcategorias;
SELECT COUNT(*) as total_bancos FROM bancos;
SELECT COUNT(*) as total_medios_pago FROM medios_pago;
