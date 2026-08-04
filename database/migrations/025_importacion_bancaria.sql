-- Migración 025: Importación masiva de movimientos bancarios
-- Fecha: 2026-07-31
-- Descripción: Infraestructura para importar extractos bancarios (Excel) a la caja banco.
--
--   NOTA: las reglas de mapeo concepto→catálogo NO viven en la base. Son fijas y
--   se versionan con el código, en `src/services/importacionBancaria/adapters/<banco>Reglas.ts`.
--
--   * `importaciones_bancarias`       → cabecera de cada importación (auditoría / reversión)
--   * `importaciones_bancarias_filas` → detalle fila por fila + hash de idempotencia
--   * columnas de trazabilidad en `movimientos`
--
-- Estrategia de idempotencia:
--   Cada fila del extracto genera un `fila_hash` determinístico. El UNIQUE sobre
--   (sucursal_id, banco_id, fila_hash) garantiza que resubir el mismo extracto (o el
--   acumulado del día siguiente) nunca duplique movimientos: las filas ya presentes
--   se omiten.

-- ============================================================
-- Paso 1: Cabecera de cada importación
-- ============================================================

CREATE TABLE IF NOT EXISTS `importaciones_bancarias` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sucursal_id` INT NOT NULL,
  `banco_id` INT NOT NULL,
  `user_id` INT NOT NULL,

  `adapter` VARCHAR(50) NOT NULL COMMENT 'Clave del adapter usado: galicia, santander, ...',
  `nombre_archivo` VARCHAR(255) NOT NULL,
  `archivo_hash` CHAR(64) NOT NULL COMMENT 'SHA-256 del archivo completo',
  `cuenta_detectada` VARCHAR(100) DEFAULT NULL COMMENT 'Ej. CC2131100751, extraído del nombre de archivo',
  `moneda` VARCHAR(3) NOT NULL DEFAULT 'ARS',

  `fecha_desde` DATE DEFAULT NULL,
  `fecha_hasta` DATE DEFAULT NULL,

  `filas_totales` INT NOT NULL DEFAULT 0,
  `filas_nuevas` INT NOT NULL DEFAULT 0,
  `filas_omitidas` INT NOT NULL DEFAULT 0 COMMENT 'Ya importadas en una corrida anterior',
  `filas_sin_mapeo` INT NOT NULL DEFAULT 0,
  `filas_ignoradas` INT NOT NULL DEFAULT 0 COMMENT 'Conceptos marcados con ignorar = 1',
  `movimientos_creados` INT NOT NULL DEFAULT 0,
  `monto_neto` DECIMAL(15,2) NOT NULL DEFAULT 0,

  `estado` ENUM('confirmada','revertida') NOT NULL DEFAULT 'confirmada',
  `revertida_por` INT DEFAULT NULL,
  `revertida_at` TIMESTAMP NULL DEFAULT NULL,

  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_import_sucursal_banco` (`sucursal_id`, `banco_id`, `created_at`),
  CONSTRAINT `fk_import_sucursal` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_import_banco` FOREIGN KEY (`banco_id`) REFERENCES `bancos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Paso 2: Detalle fila por fila (drill-down + idempotencia)
-- ============================================================
-- Esta tabla es la que hace que la importación sea segura de repetir. El movimiento
-- en la caja es el agregado; acá queda el respaldo de qué filas del banco lo formaron.

CREATE TABLE IF NOT EXISTS `importaciones_bancarias_filas` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `importacion_id` INT NOT NULL,
  `movimiento_id` INT DEFAULT NULL COMMENT 'Movimiento agregado al que contribuyó esta fila',
  `sucursal_id` INT NOT NULL,
  `banco_id` INT NOT NULL,

  `fila_hash` CHAR(64) NOT NULL,
  `operacion_id` VARCHAR(100) DEFAULT NULL COMMENT 'ID del banco, si lo trae (ej. IAZ757927708)',

  `fecha` DATE NOT NULL,
  `concepto_codigo` VARCHAR(50) DEFAULT NULL,
  `concepto_descripcion` VARCHAR(255) DEFAULT NULL,
  `grupo_codigo` VARCHAR(50) DEFAULT NULL,
  `descripcion_banco` VARCHAR(255) DEFAULT NULL,
  `monto` DECIMAL(15,2) NOT NULL COMMENT 'Signado: positivo ingreso, negativo egreso',
  `estado_banco` VARCHAR(50) DEFAULT NULL COMMENT 'Ej. Galicia: Imputado / Pendiente',
  `saldo_banco` DECIMAL(15,2) DEFAULT NULL,
  `raw` JSON DEFAULT NULL COMMENT 'Fila original completa, por si el banco cambia el layout',

  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fila_idempotencia` (`sucursal_id`, `banco_id`, `fila_hash`),
  KEY `idx_fila_importacion` (`importacion_id`),
  KEY `idx_fila_movimiento` (`movimiento_id`),
  KEY `idx_fila_fecha` (`sucursal_id`, `banco_id`, `fecha`),
  CONSTRAINT `fk_fila_importacion` FOREIGN KEY (`importacion_id`) REFERENCES `importaciones_bancarias` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fila_movimiento` FOREIGN KEY (`movimiento_id`) REFERENCES `movimientos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Paso 3: Trazabilidad en movimientos
-- ============================================================

ALTER TABLE `movimientos`
  ADD COLUMN `origen` ENUM('manual','importacion') NOT NULL DEFAULT 'manual' AFTER `tipo_movimiento`;

ALTER TABLE `movimientos`
  ADD COLUMN `importacion_id` INT DEFAULT NULL AFTER `origen`;

ALTER TABLE `movimientos`
  ADD CONSTRAINT `fk_movimientos_importacion`
  FOREIGN KEY (`importacion_id`) REFERENCES `importaciones_bancarias` (`id`) ON DELETE SET NULL;

CREATE INDEX `idx_movimientos_importacion` ON `movimientos` (`importacion_id`);
