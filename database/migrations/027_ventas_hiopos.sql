-- Migración 027: Ventas pasa a Hiopos (HiOffice / Bridge ICG). Se elimina Bistrosoft.
-- Fecha: 2026-10-08
-- Requiere: 026_ventas_integraciones.sql
--
--   * Borra todo lo importado desde Bistrosoft y deja `fuente` solo en 'hiopos'.
--   * ventas_lineas: vendedor, caja, número de documento visible y tipo de documento.
--   * ventas_sincronizaciones: tipo de corrida ('rango' = días completos, 'cambios' =
--     documentos modificados desde la última marca de agua).
--   * ventas_hiopos_config: dashboard de exportación, mapeo de columnas y marca de agua.
--   * ventas_reportes_guardados / ventas_reportes_programados: constructor de reportes
--     y envíos por mail.
--
-- Compatible con MySQL viejo: las columnas nuevas se agregan consultando
-- information_schema (no hay ADD COLUMN IF NOT EXISTS). Se puede correr más de una vez.

-- ============================================================
-- 1. Fuera Bistrosoft
-- ============================================================

DELETE FROM `ventas_lineas` WHERE `fuente` = 'bistrosoft';
DELETE FROM `ventas_dias_sincronizados` WHERE `fuente` = 'bistrosoft';
DELETE FROM `ventas_sincronizaciones` WHERE `fuente` = 'bistrosoft';
DELETE FROM `ventas_locales_externos` WHERE `fuente` = 'bistrosoft';
DELETE FROM `ventas_fuentes_estado` WHERE `fuente` = 'bistrosoft';

ALTER TABLE `ventas_locales_externos`
  MODIFY `fuente` ENUM('hiopos') NOT NULL DEFAULT 'hiopos',
  MODIFY `codigo_externo` VARCHAR(100) NOT NULL COMMENT 'Código (o nombre) del almacén/tienda en HiOffice';
ALTER TABLE `ventas_sincronizaciones` MODIFY `fuente` ENUM('hiopos') NOT NULL DEFAULT 'hiopos';
ALTER TABLE `ventas_lineas` MODIFY `fuente` ENUM('hiopos') NOT NULL DEFAULT 'hiopos';
ALTER TABLE `ventas_dias_sincronizados` MODIFY `fuente` ENUM('hiopos') NOT NULL DEFAULT 'hiopos';
ALTER TABLE `ventas_fuentes_estado` MODIFY `fuente` ENUM('hiopos') NOT NULL DEFAULT 'hiopos';

INSERT IGNORE INTO `ventas_fuentes_estado` (`fuente`) VALUES ('hiopos');

-- ============================================================
-- 2. Columnas nuevas
-- ============================================================

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ventas_lineas' AND COLUMN_NAME = 'vendedor');
SET @sql := IF(@existe = 0,
  'ALTER TABLE `ventas_lineas`
     ADD COLUMN `documento` VARCHAR(100) DEFAULT NULL COMMENT ''Serie-número visible del ticket/factura'' AFTER `transaccion_id`,
     ADD COLUMN `tipo_documento` VARCHAR(100) DEFAULT NULL AFTER `documento`,
     ADD COLUMN `vendedor` VARCHAR(150) DEFAULT NULL AFTER `canal`,
     ADD COLUMN `caja` VARCHAR(100) DEFAULT NULL AFTER `vendedor`,
     ADD KEY `idx_lineas_vendedor` (`fecha`, `vendedor`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ventas_sincronizaciones' AND COLUMN_NAME = 'tipo');
SET @sql := IF(@existe = 0,
  'ALTER TABLE `ventas_sincronizaciones`
     ADD COLUMN `tipo` ENUM(''rango'',''cambios'') NOT NULL DEFAULT ''rango'' COMMENT ''rango = días completos; cambios = modificados desde la marca de agua'' AFTER `origen`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- 3. Configuración de Hiopos (una sola fila, id = 1). Las credenciales NO van acá:
--    HIOPOS_EMAIL / HIOPOS_PASSWORD en las variables de entorno.
-- ============================================================

CREATE TABLE IF NOT EXISTS `ventas_hiopos_config` (
  `id` TINYINT NOT NULL DEFAULT 1,
  `exportation_id` VARCHAR(64) DEFAULT NULL COMMENT 'GUID del dashboard de exportación de HiOffice. NULL = usar HIOPOS_EXPORTATION_ID',
  `attr_fecha_modificado` INT DEFAULT NULL COMMENT 'attributeId del filtro Datetime BETWEEN "Fecha Modificado"',
  `mapeo_columnas` JSON DEFAULT NULL COMMENT '{ campoNormalizado: "Nombre de columna del export" }',
  `columnas_detectadas` JSON DEFAULT NULL COMMENT 'Columnas y valores de ejemplo vistos en el último diagnóstico',
  `filtros_dashboard` JSON DEFAULT NULL COMMENT 'Plantilla de getExportationDashboardFilters',
  `dias_por_tramo` INT NOT NULL DEFAULT 5 COMMENT 'Días de ventas por cada llamada a launch',
  `watermark_ms` BIGINT DEFAULT NULL COMMENT 'Mayor Fecha Modificado procesada (epoch ms)',
  `verificado_at` DATETIME DEFAULT NULL,
  `ultimo_error` TEXT DEFAULT NULL,
  `updated_by` INT DEFAULT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `ventas_hiopos_config` (`id`) VALUES (1);

-- ============================================================
-- 4. Reportes guardados y envíos programados
-- ============================================================

CREATE TABLE IF NOT EXISTS `ventas_reportes_guardados` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(120) NOT NULL,
  `descripcion` VARCHAR(255) DEFAULT NULL,
  `config` JSON NOT NULL COMMENT 'Dimensiones, métricas, filtros, período relativo, orden',
  `compartido` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = lo ven todos los usuarios con acceso a Ventas',
  `user_id` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reportes_usuario` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ventas_reportes_programados` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(120) NOT NULL,
  `frecuencia` ENUM('diaria','semanal','mensual') NOT NULL DEFAULT 'diaria',
  `dia_semana` TINYINT DEFAULT NULL COMMENT 'Semanal: 1 = lunes … 7 = domingo',
  `hora` TINYINT NOT NULL DEFAULT 8 COMMENT 'Hora de Argentina a partir de la cual se envía',
  `destinatarios` TEXT NOT NULL COMMENT 'Emails separados por coma',
  `sucursal_ids` JSON DEFAULT NULL COMMENT 'NULL = todas',
  `reporte_guardado_id` INT DEFAULT NULL COMMENT 'Reporte del constructor que se adjunta (tabla + Excel)',
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `ultimo_envio_at` DATETIME DEFAULT NULL,
  `ultimo_periodo` VARCHAR(30) DEFAULT NULL COMMENT 'Período ya enviado (evita mandar dos veces el mismo)',
  `ultimo_error` TEXT DEFAULT NULL,
  `user_id` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_programados_activo` (`activo`),
  CONSTRAINT `fk_programado_reporte` FOREIGN KEY (`reporte_guardado_id`) REFERENCES `ventas_reportes_guardados` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 5. Módulo y permisos (la API también los sincroniza al arrancar)
-- ============================================================

INSERT INTO `modulos` (`clave`, `nombre`, `descripcion`) VALUES
  ('ventas', 'Ventas', 'Ventas consolidadas desde Hiopos: panel gerencial, reportes e integración')
ON DUPLICATE KEY UPDATE `nombre` = VALUES(`nombre`), `descripcion` = VALUES(`descripcion`);

INSERT INTO `permisos` (`clave`, `descripcion`, `categoria`) VALUES
  ('configurar_ventas', 'Configurar la integración con Hiopos (dashboard, columnas) y asignar locales a sucursales', 'Ventas'),
  ('gestionar_reportes_ventas', 'Compartir reportes de ventas y programar envíos por mail', 'Ventas')
ON DUPLICATE KEY UPDATE `descripcion` = VALUES(`descripcion`), `categoria` = VALUES(`categoria`);
