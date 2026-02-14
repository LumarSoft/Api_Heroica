-- =====================================================
-- MIGRACIÓN COMPLETA DE BASE DE DATOS
-- Base de datos: heroica3
-- Fecha: 2026-02-13
-- Descripción: Creación completa de todas las tablas
-- =====================================================

-- Crear base de datos si no existe
CREATE DATABASE IF NOT EXISTS heroica3 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE heroica3;

-- =====================================================
-- TABLA: usuarios
-- =====================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  rol ENUM('admin', 'empleado', 'contador') DEFAULT 'empleado',
  activo TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_email (email),
  INDEX idx_email (email),
  INDEX idx_rol (rol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: sucursales
-- =====================================================

CREATE TABLE IF NOT EXISTS sucursales (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(255) NOT NULL,
  razon_social VARCHAR(255) NOT NULL,
  cuit VARCHAR(13) NOT NULL,
  direccion VARCHAR(500) NOT NULL,
  activo TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  email_correspondencia VARCHAR(255),
  documentacion_path VARCHAR(500),
  documentacion_nombre VARCHAR(255),
  
  UNIQUE KEY unique_cuit (cuit),
  INDEX idx_cuit (cuit),
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: categorias
-- =====================================================

CREATE TABLE IF NOT EXISTS categorias (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_nombre (nombre),
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: subcategorias
-- =====================================================

CREATE TABLE IF NOT EXISTS subcategorias (
  id INT PRIMARY KEY AUTO_INCREMENT,
  categoria_id INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_subcategoria (categoria_id, nombre),
  INDEX idx_categoria (categoria_id),
  INDEX idx_activo (activo),
  
  FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: bancos
-- =====================================================

CREATE TABLE IF NOT EXISTS bancos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL,
  codigo VARCHAR(10),
  activo TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY unique_nombre (nombre),
  INDEX idx_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: movimientos_caja_efectivo
-- =====================================================

CREATE TABLE IF NOT EXISTS movimientos_caja_efectivo (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sucursal_id INT NOT NULL,
  user_id INT NOT NULL,
  fecha DATE NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  monto DECIMAL(15,2) NOT NULL,
  descripcion TEXT,
  prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
  tipo_movimiento ENUM('saldo_real', 'saldo_necesario') NOT NULL,
  estado ENUM('pendiente', 'aprobado', 'rechazado', 'completado') DEFAULT 'pendiente',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Relaciones
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  
  -- Índices
  INDEX idx_sucursal_id (sucursal_id),
  INDEX idx_user_id (user_id),
  INDEX idx_fecha (fecha),
  INDEX idx_tipo_movimiento (tipo_movimiento),
  INDEX idx_estado (estado),
  INDEX idx_prioridad (prioridad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: pagos_pendientes
-- =====================================================

CREATE TABLE IF NOT EXISTS pagos_pendientes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sucursal_id INT NOT NULL,
  user_id INT NOT NULL,
  fecha DATE NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  monto DECIMAL(15,2) NOT NULL,
  descripcion TEXT,
  prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
  tipo_movimiento ENUM('saldo_real', 'saldo_necesario') NOT NULL,
  estado ENUM('pendiente', 'aprobado', 'rechazado', 'completado') DEFAULT 'pendiente',
  
  -- Campos específicos de pagos pendientes
  motivo_rechazo TEXT,
  usuario_revisor_id INT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Relaciones
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  FOREIGN KEY (usuario_revisor_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  
  -- Índices
  INDEX idx_sucursal_id (sucursal_id),
  INDEX idx_user_id (user_id),
  INDEX idx_fecha (fecha),
  INDEX idx_tipo_movimiento (tipo_movimiento),
  INDEX idx_estado (estado),
  INDEX idx_prioridad (prioridad),
  INDEX idx_usuario_revisor_id (usuario_revisor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT = 'Órdenes de pago pendientes de autorización';

-- =====================================================
-- TABLA: movimientos_caja_banco
-- =====================================================

CREATE TABLE IF NOT EXISTS movimientos_caja_banco (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sucursal_id INT NOT NULL,
  user_id INT NOT NULL,
  fecha DATE NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  monto DECIMAL(15,2) NOT NULL,
  descripcion TEXT,
  prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
  tipo_movimiento ENUM('saldo_real', 'saldo_necesario') NOT NULL,
  estado ENUM('pendiente', 'aprobado', 'rechazado', 'completado') DEFAULT 'pendiente',
  
  -- Campos específicos de banco
  numero_cheque VARCHAR(50),
  banco VARCHAR(100),
  cuenta VARCHAR(50),
  cbu VARCHAR(22),
  tipo_operacion ENUM('transferencia', 'cheque', 'debito', 'credito', 'otro'),
  
  -- Relación con pago pendiente (si aplica)
  pago_pendiente_id INT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Relaciones
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  FOREIGN KEY (pago_pendiente_id) REFERENCES pagos_pendientes(id) ON DELETE SET NULL,
  
  -- Índices
  INDEX idx_sucursal_id (sucursal_id),
  INDEX idx_user_id (user_id),
  INDEX idx_fecha (fecha),
  INDEX idx_tipo_movimiento (tipo_movimiento),
  INDEX idx_estado (estado),
  INDEX idx_prioridad (prioridad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT = 'Movimientos de caja banco con saldo real y necesario';

-- =====================================================
-- Fin de la migración de estructura
-- =====================================================
