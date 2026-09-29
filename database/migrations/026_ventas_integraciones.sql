-- Migración 026: Módulo de Ventas e integraciones (Bistrosoft; Hiopos preparado)
-- Fecha: 2026-09-28
-- Descripción: Ventas consolidadas desde las API de los puntos de venta.
--
--   * `ventas_locales_externos`  → locales/comercios informados por cada fuente y su
--                                   sucursal Heroica equivalente (mapeo editable).
--   * `ventas_sincronizaciones`  → historial de corridas (automáticas y manuales).
--   * `ventas_lineas`            → una fila por línea importada (producto consumido o
--                                   medio de pago), normalizada + JSON original.
--
-- Estrategia de "una única versión de cada venta":
--   La fuente se consulta DÍA POR DÍA. Recién cuando todas las páginas de un día llegaron
--   bien, en una transacción se reemplazan las líneas de esa fuente para ese día operativo
--   (`fecha` = día consultado; la hora real queda en `fecha_hora`, que puede caer pasada
--   la medianoche). Así una venta anulada o corregida en el POS queda con su último estado
--   y una re-sincronización nunca duplica. El UNIQUE (fuente, linea_hash) es la segunda
--   barrera: si dos corridas se pisan, la segunda falla en vez de duplicar.
--
-- Ejecución en Vercel (serverless, sin procesos de fondo ni node-cron):
--   Una corrida se procesa por tramos. Cada invocación (Vercel Cron, o la app al abrir
--   el panel) toma el candado de la fuente en `ventas_fuentes_estado`, procesa días
--   hasta agotar su presupuesto de tiempo y guarda en `proximo_dia` desde dónde seguir.

CREATE TABLE IF NOT EXISTS `ventas_locales_externos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `fuente` ENUM('bistrosoft','hiopos') NOT NULL,
  `codigo_externo` VARCHAR(100) NOT NULL COMMENT 'shopCode en Bistrosoft',
  `nombre_externo` VARCHAR(255) DEFAULT NULL,
  `sucursal_id` INT DEFAULT NULL COMMENT 'NULL = todavía sin asignar',
  `asignacion` ENUM('automatica','manual') DEFAULT NULL COMMENT 'automatica = por nombre; manual = la eligió una persona (no se vuelve a tocar)',
  `ultima_venta_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_local_externo` (`fuente`, `codigo_externo`),
  KEY `idx_local_sucursal` (`sucursal_id`),
  CONSTRAINT `fk_local_externo_sucursal` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ventas_sincronizaciones` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `fuente` ENUM('bistrosoft','hiopos') NOT NULL,
  `origen` ENUM('automatica','manual') NOT NULL,
  `user_id` INT DEFAULT NULL,
  `fecha_desde` DATE NOT NULL,
  `fecha_hasta` DATE NOT NULL,
  `estado` ENUM('en_curso','exitosa','con_observaciones','fallida') NOT NULL DEFAULT 'en_curso',
  `paginas` INT NOT NULL DEFAULT 0,
  `registros_recibidos` INT NOT NULL DEFAULT 0,
  `registros_importados` INT NOT NULL DEFAULT 0,
  `registros_observados` INT NOT NULL DEFAULT 0 COMMENT 'Importados pero con datos incompletos (ej. local sin sucursal)',
  `registros_rechazados` INT NOT NULL DEFAULT 0 COMMENT 'Sin importe reconocible: no se importan',
  `registros_reemplazados` INT NOT NULL DEFAULT 0 COMMENT 'Líneas previas del rango que se reemplazaron',
  `dias_nuevos` INT NOT NULL DEFAULT 0 COMMENT 'Días que no estaban importados',
  `dias_actualizados` INT NOT NULL DEFAULT 0 COMMENT 'Días que ya estaban y se volvieron a traer (sin duplicar)',
  `mensaje` TEXT DEFAULT NULL,
  `proximo_dia` DATE DEFAULT NULL COMMENT 'Siguiente día a procesar mientras está en curso',
  `iniciada_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `finalizada_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sync_fuente_estado` (`fuente`, `estado`, `iniciada_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ventas_lineas` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `fuente` ENUM('bistrosoft','hiopos') NOT NULL,
  `sincronizacion_id` INT NOT NULL,
  `linea_hash` CHAR(64) NOT NULL,
  `local_externo_id` INT DEFAULT NULL,
  `sucursal_id` INT DEFAULT NULL,

  `transaccion_id` VARCHAR(100) NOT NULL,
  `fecha` DATE NOT NULL COMMENT 'Día operativo consultado a la fuente',
  `fecha_hora` DATETIME DEFAULT NULL COMMENT 'Momento de la línea, hora local Argentina',
  `tipo_linea` ENUM('producto','pago','descuento','caja','otro') NOT NULL COMMENT 'pago = encabezado del ticket; caja = apertura/retiro/cierre',

  `producto_codigo` VARCHAR(100) DEFAULT NULL,
  `producto_nombre` VARCHAR(255) DEFAULT NULL,
  `categoria` VARCHAR(150) DEFAULT NULL,
  `cantidad` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `precio_unitario` DECIMAL(15,2) DEFAULT NULL,
  `importe` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `descuento` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `medio_pago` VARCHAR(150) DEFAULT NULL,
  `canal` VARCHAR(150) DEFAULT NULL,
  `estado_origen` VARCHAR(100) DEFAULT NULL,
  `anulada` TINYINT(1) NOT NULL DEFAULT 0,
  `observada` TINYINT(1) NOT NULL DEFAULT 0,
  `raw` JSON DEFAULT NULL COMMENT 'Ítem original de la API',

  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_linea_fuente_hash` (`fuente`, `linea_hash`),
  KEY `idx_lineas_fecha_sucursal` (`fecha`, `sucursal_id`, `tipo_linea`),
  KEY `idx_lineas_fuente_fecha` (`fuente`, `fecha`),
  KEY `idx_lineas_transaccion` (`fuente`, `transaccion_id`),
  KEY `idx_lineas_sincronizacion` (`sincronizacion_id`),
  CONSTRAINT `fk_lineas_sincronizacion` FOREIGN KEY (`sincronizacion_id`) REFERENCES `ventas_sincronizaciones` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lineas_local` FOREIGN KEY (`local_externo_id`) REFERENCES `ventas_locales_externos` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_lineas_sucursal` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Días importados (cobertura): permite mostrar "datos disponibles del X al Y" y
-- detectar días sin importar. Un día sin ventas también queda registrado (lineas = 0).
-- ============================================================

CREATE TABLE IF NOT EXISTS `ventas_dias_sincronizados` (
  `fuente` ENUM('bistrosoft','hiopos') NOT NULL,
  `fecha` DATE NOT NULL,
  `sincronizacion_id` INT DEFAULT NULL,
  `lineas` INT NOT NULL DEFAULT 0,
  `tickets` INT NOT NULL DEFAULT 0,
  `actualizado_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`fuente`, `fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Candado y ritmo de llamadas por fuente (compartido entre instancias serverless)
-- ============================================================

CREATE TABLE IF NOT EXISTS `ventas_fuentes_estado` (
  `fuente` ENUM('bistrosoft','hiopos') NOT NULL,
  `lock_hasta` DATETIME DEFAULT NULL COMMENT 'Mientras sea futuro, una invocación está procesando',
  `ultima_llamada_ms` BIGINT DEFAULT NULL COMMENT 'Epoch ms de la última llamada a la API externa (rate limit)',
  PRIMARY KEY (`fuente`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `ventas_fuentes_estado` (`fuente`) VALUES ('bistrosoft'), ('hiopos');

-- ============================================================
-- Módulo y permisos (también los sincroniza la API al arrancar; se dejan acá
-- porque en Vercel el arranque no está garantizado antes del primer uso)
-- ============================================================

INSERT INTO `modulos` (`clave`, `nombre`, `descripcion`) VALUES
  ('ventas', 'Ventas', 'Ventas consolidadas desde Bistrosoft y Hiopos, panel gerencial e integraciones')
ON DUPLICATE KEY UPDATE `nombre` = VALUES(`nombre`), `descripcion` = VALUES(`descripcion`);

INSERT INTO `permisos` (`clave`, `descripcion`, `categoria`) VALUES
  ('ver_ventas', 'Ver el panel de ventas y las operaciones importadas', 'Ventas'),
  ('exportar_ventas', 'Exportar ventas a Excel', 'Ventas'),
  ('sincronizar_ventas', 'Ver el estado de las integraciones y sincronizar ventas manualmente', 'Ventas'),
  ('configurar_ventas', 'Asignar los locales de Bistrosoft/Hiopos a sucursales y diagnosticar integraciones', 'Ventas')
ON DUPLICATE KEY UPDATE `descripcion` = VALUES(`descripcion`), `categoria` = VALUES(`categoria`);

-- ============================================================
-- Vinculaciones conocidas cuyo nombre NO coincide con la sucursal de Heroica
-- (las que coinciden, como HEROICA GUEMES → Heroica Güemes, se vinculan solas).
-- Se busca la sucursal por nombre para no depender del id de cada base. Se marcan como
-- 'automatica': las definió el sistema, no una persona desde la pantalla.
-- ============================================================

INSERT INTO `ventas_locales_externos` (`fuente`, `codigo_externo`, `nombre_externo`, `sucursal_id`, `asignacion`)
SELECT 'bistrosoft', '11112935', 'HEROICA CORDOBA SHOPPING', s.`id`, 'automatica'
FROM `sucursales` s
WHERE s.`nombre` = 'Heroica Alto Córdoba' AND s.`deleted_at` IS NULL
LIMIT 1
ON DUPLICATE KEY UPDATE `sucursal_id` = VALUES(`sucursal_id`), `asignacion` = 'automatica';

-- Si ya se habían importado ventas de ese local, pasan a la sucursal.
UPDATE `ventas_lineas` l
JOIN `ventas_locales_externos` le ON le.`id` = l.`local_externo_id`
SET l.`sucursal_id` = le.`sucursal_id`, l.`observada` = 0
WHERE le.`fuente` = 'bistrosoft' AND le.`codigo_externo` = '11112935' AND le.`sucursal_id` IS NOT NULL;
