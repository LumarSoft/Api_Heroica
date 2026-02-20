-- =====================================================
-- SCRIPT DE ESTRUCTURAS UNIFICADAS - DB HEROICA
-- Este script recrea las tablas necesarias para el
-- funcionamiento del sistema, unificando los movimientos
-- en una sola entidad.
-- =====================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. LIMPIEZA DE TABLAS
DROP TABLE IF EXISTS movimientos_caja_banco;
DROP TABLE IF EXISTS movimientos_caja_efectivo;
DROP TABLE IF EXISTS pagos_pendientes;
DROP TABLE IF EXISTS movimientos;
DROP TABLE IF EXISTS subcategorias;
DROP TABLE IF EXISTS categorias;
DROP TABLE IF EXISTS bancos;
DROP TABLE IF EXISTS medios_pago;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS sucursales;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================
-- 2. TABLAS MAESTRAS (Sucursales, Usuarios, Catálogos)
-- =====================================================

CREATE TABLE `sucursales` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `razon_social` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cuit` varchar(13) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  `direccion` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activo` tinyint(1) DEFAULT '1',
  `email_correspondencia` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `documentacion_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `documentacion_nombre` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `usuarios` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rol` enum('admin','empleado','contador') COLLATE utf8mb4_unicode_ci DEFAULT 'empleado',
  `activo` tinyint(1) DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `categorias` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  `descripcion` text COLLATE utf8mb4_unicode_ci,
  `activo` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `subcategorias` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `categoria_id` int NOT NULL,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text COLLATE utf8mb4_unicode_ci,
  `activo` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `unique_subcategoria` (`categoria_id`,`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bancos` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  `codigo` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activo` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `medios_pago` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  `descripcion` text COLLATE utf8mb4_unicode_ci,
  `activo` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. TABLA DE MOVIMIENTOS UNIFICADA
-- =====================================================

CREATE TABLE `movimientos` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `sucursal_id` int NOT NULL,
  `user_id` int NOT NULL,
  `fecha` date NOT NULL,
  `concepto` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text COLLATE utf8mb4_unicode_ci,
  `monto` decimal(15,2) NOT NULL,
  `tipo` enum('ingreso','egreso') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ingreso',
  
  -- Para distinguir el origen/destino del movimiento (Banco, Efectivo, o Pendientes de pago)
  `tipo_movimiento` enum('banco','efectivo','pendiente') COLLATE utf8mb4_unicode_ci NOT NULL,
  
  -- Clasificación de saldo. Se permite NULL en caso de ser un "pago_pendiente" 
  -- que todavía no ha sido asignado a un tipo de saldo específico.
  `saldo` enum('saldo_real','saldo_necesario') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  
  -- Control de estado y prioridad
  `estado` enum('pendiente','aprobado','rechazado','completado') COLLATE utf8mb4_unicode_ci DEFAULT 'pendiente',
  `prioridad` enum('baja','media','alta') COLLATE utf8mb4_unicode_ci DEFAULT 'media',
  
  -- Info Bancaria
  `numero_cheque` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `banco` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cuenta` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cbu` varchar(22) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tipo_operacion` enum('transferencia','cheque','debito','credito','otro') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  
  -- Proceso de Aprobación/Revisión (Heredado de pagos pendientes)
  `proveedor` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `usuario_revisor_id` int DEFAULT NULL,
  `motivo_rechazo` text COLLATE utf8mb4_unicode_ci,
  `fecha_revision` datetime DEFAULT NULL,
  
  -- Categorías y Relaciones extra
  `categoria_id` int DEFAULT NULL,
  `subcategoria_id` int DEFAULT NULL,
  `banco_id` int DEFAULT NULL,
  `medio_pago_id` int DEFAULT NULL,
  
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`usuario_revisor_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`subcategoria_id`) REFERENCES `subcategorias`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`banco_id`) REFERENCES `bancos`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`medio_pago_id`) REFERENCES `medios_pago`(`id`) ON DELETE SET NULL,
  
  INDEX `idx_sucursal_tipo` (`sucursal_id`, `tipo_movimiento`),
  INDEX `idx_fecha` (`fecha`),
  INDEX `idx_estado` (`estado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
