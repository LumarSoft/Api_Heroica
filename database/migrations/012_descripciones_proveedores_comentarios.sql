-- Migración 012: Catálogos de Descripciones y Proveedores + renombrar campo comentarios
-- Fecha: 2026-04-11
-- Descripción: Crea las tablas de catálogo `descripciones` y `proveedores`, renombra el
--              campo `descripcion` a `comentarios` en la tabla `movimientos`, agrega las
--              columnas FK `descripcion_id` y `proveedor_id`, y elimina la columna
--              `proveedor` (texto libre) que queda obsoleta.

-- ============================================================
-- Paso 1: Crear tabla de catálogo de Descripciones
-- ============================================================

CREATE TABLE IF NOT EXISTS `descripciones` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(255) NOT NULL,
  `activo` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Paso 2: Crear tabla de catálogo de Proveedores
-- ============================================================

CREATE TABLE IF NOT EXISTS `proveedores` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(255) NOT NULL,
  `activo` TINYINT(1) DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Paso 3: Renombrar columna `descripcion` → `comentarios` en movimientos
--         (ejecutar solo si la columna aún se llama `descripcion`)
-- ============================================================

ALTER TABLE `movimientos`
  CHANGE `descripcion` `comentarios` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================
-- Paso 4: Agregar columna FK `descripcion_id` hacia la tabla descripciones
-- ============================================================

ALTER TABLE `movimientos`
  ADD COLUMN `descripcion_id` INT DEFAULT NULL;

ALTER TABLE `movimientos`
  ADD CONSTRAINT `fk_movimientos_descripcion`
  FOREIGN KEY (`descripcion_id`) REFERENCES `descripciones` (`id`) ON DELETE SET NULL;

-- ============================================================
-- Paso 5: Agregar columna FK `proveedor_id` hacia la tabla proveedores
-- ============================================================

ALTER TABLE `movimientos`
  ADD COLUMN `proveedor_id` INT DEFAULT NULL;

ALTER TABLE `movimientos`
  ADD CONSTRAINT `fk_movimientos_proveedor`
  FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores` (`id`) ON DELETE SET NULL;

-- ============================================================
-- Paso 6: Eliminar columna `proveedor` (texto libre, ya no se usa)
--         (ejecutar solo si la columna aún existe)
-- ============================================================

ALTER TABLE `movimientos`
  DROP COLUMN `proveedor`;
