-- ============================================================================
-- MASTER — nivelar la base de datos tras el merge dev -> main (PR #40, 2026-07-01)
-- ============================================================================
-- Aplica, EN UN SOLO PASO y en el orden correcto de dependencias, todo lo que
-- el merge trajo y que todavía no está reflejado en la base de datos:
--
--   1. CONSOLIDADO_actualizar_pro.sql   (corregido: FK circular personal <-> rrhh_solicitudes)
--   2. RH-LiqFinal_ajustes.sql
--   3. RH-LiqFinal_envio_calendario.sql
--   4. RH-Sueldos_envio_pagos.sql
--   5. RH-64_add_sucursal_to_escalas_salariales.sql
--   6. personal_documentos.sql
--   7. RH-65_modulos_acceso.sql
--   8. RH-66_revertir_escalacion_admin.sql
--
-- IDEMPOTENTE: todo bloque que no era seguro de re-ejecutar (CREATE TABLE sin
-- IF NOT EXISTS, ALTER TABLE ADD COLUMN/CONSTRAINT sin guard) fue envuelto con
-- un chequeo de information_schema, siguiendo el mismo patrón que ya usa
-- refactor_sueldos_simulacion.sql en este repo. Podés correr este archivo
-- las veces que haga falta: lo que ya esté aplicado se saltea.
--
-- NO incluidos a propósito (no forman parte de este merge / son de otra rama):
--   - AUDIT-00 a AUDIT-05 (rama "reestructuracion", ver AUDITORIA_DB.md)
--
-- NOTA sobre permisos: `permisos` y `modulos` se sincronizan automáticamente
-- al arrancar la API (syncPermisos() / syncModulos() en src/index.ts), así que
-- este script no necesita insertarlos a mano. Lo que sí requiere SQL manual es
-- la ASIGNACIÓN de permisos a roles (`roles_permisos`) y el acceso por usuario
-- a módulos (`usuarios_modulos`), que es lo que hacen los bloques de abajo.
--
-- NOTA sobre 'admin': por diseño explícito (ver RH-66), el rol 'admin' NO
-- tiene acceso a Incentivos, Sueldos ni "aprobar solicitudes" — hoy esas
-- acciones son exclusivas de 'superadmin' (bypass total de permisos). Si
-- Lucas quiere que 'admin' o 'gerente' también accedan, es una decisión de
-- negocio que se hace desde Configuración → Roles, no algo que este script
-- deba forzar.
--
-- Hacé un backup antes de correr esto en producción.
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- PARTE 1/8 — CONSOLIDADO_actualizar_pro.sql (con fix de FK circular)
-- ============================================================================

-- ---- 1. ROL gerente ----
INSERT IGNORE INTO `roles` (`nombre`, `descripcion`, `es_sistema`)
VALUES ('gerente', 'Solo lectura + comentarios', 0);

-- ---- 2. PERMISOS NUEVOS (RRHH) ----
-- (Redundante con syncPermisos(), pero inofensivo dejarlo: usa INSERT IGNORE)
INSERT IGNORE INTO `permisos` (`clave`, `descripcion`, `categoria`) VALUES
('ver_areas',                       'Ver áreas de la organización',                     'Recursos Humanos'),
('gestionar_areas',                  'Crear, editar y eliminar áreas',                   'Recursos Humanos'),
('ver_personal',                     'Ver legajos del personal',                         'Recursos Humanos'),
('crear_personal',                   'Crear nuevos legajos',                             'Recursos Humanos'),
('gestionar_personal',               'Editar legajos existentes',                        'Recursos Humanos'),
('eliminar_personal',                'Dar de baja legajos',                              'Recursos Humanos'),
('ver_puestos',                      'Ver puestos de trabajo',                           'Recursos Humanos'),
('gestionar_puestos',                'Crear, editar y eliminar puestos',                 'Recursos Humanos'),
('ver_escalas',                      'Ver escalas salariales',                           'Recursos Humanos'),
('gestionar_escalas',                'Crear, editar y eliminar escalas salariales',      'Recursos Humanos'),
('ver_calendario',                   'Ver calendario de RRHH',                           'Recursos Humanos'),
('gestionar_calendario',             'Crear y editar eventos del calendario RRHH',       'Recursos Humanos'),
('ver_solicitudes',                  'Ver solicitudes de RRHH',                          'Recursos Humanos'),
('crear_solicitudes',                'Crear solicitudes de RRHH',                        'Recursos Humanos'),
('editar_solicitudes',               'Editar solicitudes de RRHH',                       'Recursos Humanos'),
('cancelar_solicitudes',             'Cancelar solicitudes de RRHH',                     'Recursos Humanos'),
('ver_historial_solicitudes_global', 'Ver historial global de solicitudes RRHH',         'Recursos Humanos');

-- ---- 3. TABLAS — en orden de dependencias ----

-- 3.1 areas
CREATE TABLE IF NOT EXISTS `areas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `areas_nombre_unique` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.2 puestos (estructura final: area_id en lugar de sucursal_id)
CREATE TABLE IF NOT EXISTS `puestos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `area_id` int NOT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `puestos_area_fk` (`area_id`),
  CONSTRAINT `puestos_area_fk` FOREIGN KEY (`area_id`) REFERENCES `areas` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.3 personal (estructura final con todas las columnas; SIN el FK a
--     rrhh_solicitudes todavía — se agrega más abajo, ver nota de la Parte 1.5)
CREATE TABLE IF NOT EXISTS `personal` (
  `id` int NOT NULL AUTO_INCREMENT,
  `legajo` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `dni` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `cuil` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `telefono` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fecha_nacimiento` date DEFAULT NULL,
  `domicilio_real` text COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Dirección real',
  `domicilio_dni` text COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Domicilio según DNI',
  `puesto_id` int NOT NULL,
  `sucursal_id` int NOT NULL,
  `fecha_incorporacion` date NOT NULL,
  `fecha_inicio_cobro` date DEFAULT NULL COMMENT 'Inicio cobro en oficina',
  `periodo_prueba` tinyint(1) NOT NULL DEFAULT 0,
  `periodo_prueba_dias` int DEFAULT NULL,
  `jornada_semanal_dias` tinyint unsigned DEFAULT NULL,
  `jornada_diaria_horas` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `propuesta_economica` decimal(14,2) DEFAULT NULL COMMENT 'Remuneración acordada al alta',
  `beneficios` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `condicion_laboral` tinyint unsigned DEFAULT NULL COMMENT 'Condición laboral 1 o 2',
  `fecha_alta_temprana` date DEFAULT NULL,
  `banco` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cbu` varchar(22) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `carnet_manipulacion_alimentos` tinyint(1) NOT NULL DEFAULT 0,
  `carnet_archivo_url` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `carnet_archivo_nombre` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `carnet_vencimiento` date DEFAULT NULL,
  `solicitud_alta_id` int DEFAULT NULL,
  `datos_alta_json` json DEFAULT NULL COMMENT 'Snapshot completo de rrhh_solicitudes.detalles (tipo Altas)',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `forma_cobro` ENUM('banco', 'efectivo') NOT NULL DEFAULT 'banco',
  PRIMARY KEY (`id`),
  UNIQUE KEY `legajo` (`legajo`),
  UNIQUE KEY `dni` (`dni`),
  KEY `personal_puesto_fk` (`puesto_id`),
  KEY `personal_sucursal_fk` (`sucursal_id`),
  KEY `idx_personal_solicitud_alta` (`solicitud_alta_id`),
  CONSTRAINT `personal_puesto_fk` FOREIGN KEY (`puesto_id`) REFERENCES `puestos` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `personal_sucursal_fk` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.4 rrhh_calendario_eventos (necesario antes de alertas)
CREATE TABLE IF NOT EXISTS `rrhh_calendario_eventos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `evento` varchar(120) NOT NULL,
  `fecha` date NOT NULL,
  `hora` time DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `participantes` text DEFAULT NULL,
  `comentarios` text DEFAULT NULL,
  `tipo_notion` varchar(80) NOT NULL DEFAULT 'General',
  `periodicidad` varchar(50) DEFAULT NULL
    COMMENT 'Recurrencia: Ninguna, Cada día, Lun-Vie, Cada semana, Cada 2 semanas, Cada mes, Primero de cada mes, Cada año',
  `creado_por` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_rrhh_calendario_fecha` (`fecha`),
  INDEX `idx_rrhh_calendario_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_rrhh_calendario_creado_por`
    FOREIGN KEY (`creado_por`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.5 rrhh_solicitudes (enum final con todos los tipos)
CREATE TABLE IF NOT EXISTS `rrhh_solicitudes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sucursal_id` int NOT NULL,
  `personal_id` int DEFAULT NULL,
  `personal_creado_id` int DEFAULT NULL,
  `usuario_id` int NOT NULL,
  `resuelto_por_usuario_id` int DEFAULT NULL,
  `tipo` enum(
    'Altas',
    'Bajas',
    'Novedades de sueldo',
    'Incentivos y premios',
    'Licencias',
    'Vacaciones',
    'Suspensiones',
    'Apercibimientos',
    'Capacitaciones',
    'Pedido de uniforme',
    'Adelantos',
    'Descuentos',
    'Horas extras',
    'Cambio de puesto/sucursal'
  ) NOT NULL,
  `estado` enum('Pendiente', 'Aprobada', 'Rechazada', 'Cancelada') NOT NULL DEFAULT 'Pendiente',
  `fecha_solicitud` date NOT NULL,
  `fecha_resolucion` datetime DEFAULT NULL,
  `detalles` json DEFAULT NULL,
  `observaciones` text DEFAULT NULL,
  `motivo_resolucion` text DEFAULT NULL,
  `liquidacion_final_estado` enum('Pendiente', 'Generada', 'No aplica', 'Error') NOT NULL DEFAULT 'No aplica',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `rrhh_solicitudes_sucursal_fk` (`sucursal_id`),
  KEY `rrhh_solicitudes_personal_fk` (`personal_id`),
  KEY `rrhh_solicitudes_personal_creado_fk` (`personal_creado_id`),
  KEY `rrhh_solicitudes_usuario_fk` (`usuario_id`),
  KEY `rrhh_solicitudes_resuelto_por_fk` (`resuelto_por_usuario_id`),
  CONSTRAINT `rrhh_solicitudes_sucursal_fk` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `rrhh_solicitudes_personal_fk` FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `rrhh_solicitudes_personal_creado_fk` FOREIGN KEY (`personal_creado_id`) REFERENCES `personal` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `rrhh_solicitudes_usuario_fk` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `rrhh_solicitudes_resuelto_por_fk` FOREIGN KEY (`resuelto_por_usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 3.5.1 FK diferida: personal.solicitud_alta_id -> rrhh_solicitudes.id ----
-- personal y rrhh_solicitudes se referencian mutuamente (ERROR #1824 si se
-- intenta poner esta FK inline en el CREATE TABLE de personal, porque
-- rrhh_solicitudes todavía no existe en ese punto). Se agrega acá, con las dos
-- tablas ya creadas, y con chequeo de information_schema para poder re-correrla.
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'personal'
    AND CONSTRAINT_NAME = 'personal_solicitud_alta_fk'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE `personal` ADD CONSTRAINT `personal_solicitud_alta_fk` FOREIGN KEY (`solicitud_alta_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.6 rrhh_solicitudes_historial (enum final)
CREATE TABLE IF NOT EXISTS `rrhh_solicitudes_historial` (
  `id` int NOT NULL AUTO_INCREMENT,
  `solicitud_id` int NOT NULL,
  `personal_id` int DEFAULT NULL,
  `usuario_id` int DEFAULT NULL,
  `evento` enum(
    'Creada',
    'Editada',
    'Aprobada',
    'Rechazada',
    'Cancelada',
    'Legajo creado',
    'Legajo desactivado',
    'Puesto actualizado',
    'Liquidacion final generada',
    'Error de liquidacion final'
  ) NOT NULL,
  `detalle` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `rrhh_solicitudes_historial_solicitud_fk` (`solicitud_id`),
  KEY `rrhh_solicitudes_historial_personal_fk` (`personal_id`),
  KEY `rrhh_solicitudes_historial_usuario_fk` (`usuario_id`),
  CONSTRAINT `rrhh_solicitudes_historial_solicitud_fk` FOREIGN KEY (`solicitud_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `rrhh_solicitudes_historial_personal_fk` FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE SET NULL,
  CONSTRAINT `rrhh_solicitudes_historial_usuario_fk` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.7 rrhh_liquidaciones_finales
CREATE TABLE IF NOT EXISTS `rrhh_liquidaciones_finales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `solicitud_id` int NOT NULL,
  `personal_id` int NOT NULL,
  `estado` enum('Pendiente', 'Generada', 'Error') NOT NULL DEFAULT 'Pendiente',
  `detalle` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rrhh_liquidaciones_finales_solicitud_unique` (`solicitud_id`),
  KEY `rrhh_liquidaciones_finales_personal_fk` (`personal_id`),
  CONSTRAINT `rrhh_liquidaciones_finales_solicitud_fk` FOREIGN KEY (`solicitud_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `rrhh_liquidaciones_finales_personal_fk` FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.8 escalas_salariales (sin sucursal_id todavía — lo agrega la Parte 5)
CREATE TABLE IF NOT EXISTS `escalas_salariales` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `puesto_id` int NOT NULL,
  `sueldo_base` decimal(12, 2) NOT NULL,
  `mes` tinyint unsigned NOT NULL COMMENT 'Mes (1-12)',
  `anio` smallint unsigned NOT NULL COMMENT 'Año',
  `valor_hora` decimal(10, 2) DEFAULT NULL COMMENT 'Valor por hora',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL COMMENT 'Eliminación lógica; NULL = activo',
  INDEX `idx_periodo` (`mes`, `anio`),
  KEY `escalas_puesto_fk` (`puesto_id`),
  CONSTRAINT `escalas_puesto_fk` FOREIGN KEY (`puesto_id`) REFERENCES `puestos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.9 rrhh_incentivos_premios (estructura final con area_id y puesto_id)
CREATE TABLE IF NOT EXISTS `rrhh_incentivos_premios` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `sucursal_id` int NOT NULL,
  `area_id` int DEFAULT NULL,
  `puesto_id` int DEFAULT NULL,
  `escala_salarial_id` int DEFAULT NULL,
  `nombre` varchar(150) NOT NULL,
  `tipo` enum('Incentivo', 'Premio') NOT NULL DEFAULT 'Incentivo',
  `descripcion` text DEFAULT NULL,
  `mes` tinyint unsigned NOT NULL COMMENT 'Mes (1-12)',
  `anio` smallint unsigned NOT NULL COMMENT 'Año',
  `metodo_calculo` enum('porcentaje_escala', 'monto_fijo', 'multiplicador_valor_hora') NOT NULL DEFAULT 'porcentaje_escala',
  `valor` decimal(12, 2) NOT NULL COMMENT 'Porcentaje, monto fijo o cantidad de horas según metodo_calculo',
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `fecha_ultima_actualizacion` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  INDEX `idx_rrhh_incentivos_periodo` (`sucursal_id`, `mes`, `anio`),
  INDEX `idx_rrhh_incentivos_escala` (`escala_salarial_id`),
  INDEX `idx_rrhh_incentivos_area` (`area_id`),
  INDEX `idx_rrhh_incentivos_puesto` (`puesto_id`),
  CONSTRAINT `fk_rrhh_incentivos_sucursal` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `fk_rrhh_incentivos_escala` FOREIGN KEY (`escala_salarial_id`) REFERENCES `escalas_salariales` (`id`),
  CONSTRAINT `fk_rrhh_incentivos_area` FOREIGN KEY (`area_id`) REFERENCES `areas` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_rrhh_incentivos_puesto` FOREIGN KEY (`puesto_id`) REFERENCES `puestos` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.10 rrhh_alertas_escalas_salariales
CREATE TABLE IF NOT EXISTS `rrhh_alertas_escalas_salariales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `escala_salarial_id` int NOT NULL,
  `anio_alerta` smallint NOT NULL COMMENT 'Año en que se envió la alerta',
  `mes_alerta` tinyint NOT NULL COMMENT 'Mes en que se envió la alerta (1-12)',
  `destinatario_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_enviado_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rrhh_alertas_escalas_unique` (`escala_salarial_id`, `anio_alerta`, `mes_alerta`),
  CONSTRAINT `rrhh_alertas_escalas_escala_fk`
    FOREIGN KEY (`escala_salarial_id`) REFERENCES `escalas_salariales` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.11 rrhh_alertas_periodo_prueba
CREATE TABLE IF NOT EXISTS `rrhh_alertas_periodo_prueba` (
  `id` int NOT NULL AUTO_INCREMENT,
  `personal_id` int NOT NULL,
  `fecha_vencimiento` date NOT NULL,
  `dias_antes` int NOT NULL,
  `calendario_evento_id` int DEFAULT NULL,
  `destinatario_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_enviado_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rrhh_alerta_periodo_prueba_unique` (`personal_id`, `fecha_vencimiento`, `dias_antes`),
  KEY `rrhh_alerta_periodo_prueba_evento_fk` (`calendario_evento_id`),
  CONSTRAINT `rrhh_alerta_periodo_prueba_personal_fk`
    FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE CASCADE,
  CONSTRAINT `rrhh_alerta_periodo_prueba_evento_fk`
    FOREIGN KEY (`calendario_evento_id`) REFERENCES `rrhh_calendario_eventos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.12 rrhh_alertas_apercibimientos
CREATE TABLE IF NOT EXISTS `rrhh_alertas_apercibimientos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `personal_id` int NOT NULL,
  `solicitud_id` int DEFAULT NULL,
  `cantidad_apercibimientos` int NOT NULL DEFAULT 2,
  `calendario_evento_id` int DEFAULT NULL,
  `destinatario_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_enviado_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rrhh_alerta_apercibimiento_personal_unique` (`personal_id`),
  KEY `rrhh_alerta_apercibimiento_solicitud_fk` (`solicitud_id`),
  KEY `rrhh_alerta_apercibimiento_evento_fk` (`calendario_evento_id`),
  CONSTRAINT `rrhh_alerta_apercibimiento_personal_fk`
    FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE CASCADE,
  CONSTRAINT `rrhh_alerta_apercibimiento_solicitud_fk`
    FOREIGN KEY (`solicitud_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `rrhh_alerta_apercibimiento_evento_fk`
    FOREIGN KEY (`calendario_evento_id`) REFERENCES `rrhh_calendario_eventos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.13 rrhh_alertas_vencimientos
CREATE TABLE IF NOT EXISTS `rrhh_alertas_vencimientos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `solicitud_id` int NOT NULL,
  `personal_id` int NOT NULL,
  `tipo` enum('Licencias','Vacaciones') COLLATE utf8mb4_unicode_ci NOT NULL,
  `fecha_vencimiento` date NOT NULL,
  `dias_antes` int NOT NULL,
  `calendario_evento_id` int DEFAULT NULL,
  `destinatario_email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email_enviado_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rrhh_alerta_vencimiento_solicitud_unique` (`solicitud_id`),
  KEY `rrhh_alerta_vencimiento_personal_fk` (`personal_id`),
  KEY `rrhh_alerta_vencimiento_evento_fk` (`calendario_evento_id`),
  CONSTRAINT `rrhh_alerta_vencimiento_solicitud_fk`
    FOREIGN KEY (`solicitud_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `rrhh_alerta_vencimiento_personal_fk`
    FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE CASCADE,
  CONSTRAINT `rrhh_alerta_vencimiento_evento_fk`
    FOREIGN KEY (`calendario_evento_id`) REFERENCES `rrhh_calendario_eventos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.14 personal_notas
CREATE TABLE IF NOT EXISTS `personal_notas` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `personal_id` int NOT NULL,
  `contenido` text NOT NULL,
  `usuario_id` int NOT NULL,
  `usuario_nombre` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  INDEX `idx_personal_notas_personal_id` (`personal_id`),
  INDEX `idx_personal_notas_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.15 rrhh_solicitudes_archivos
CREATE TABLE IF NOT EXISTS `rrhh_solicitudes_archivos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `solicitud_id` int NOT NULL,
  `tipo_doc` varchar(80) NOT NULL,
  `url` text NOT NULL,
  `nombre_original` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_solicitudes_archivos_solicitud` (`solicitud_id`),
  CONSTRAINT `fk_solicitudes_archivos_solicitud`
    FOREIGN KEY (`solicitud_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.16 rrhh_solicitudes_novedades_empleados
CREATE TABLE IF NOT EXISTS `rrhh_solicitudes_novedades_empleados` (
  `id` int NOT NULL AUTO_INCREMENT,
  `solicitud_id` int NOT NULL,
  `personal_id` int NOT NULL,
  `personal_nombre` varchar(255) NOT NULL,
  `tipo_origen` enum('novedad_sueldo','liquidacion_baja') NOT NULL DEFAULT 'novedad_sueldo',
  `cambio_puesto` tinyint(1) NOT NULL DEFAULT '0',
  `nuevo_puesto_id` int DEFAULT NULL,
  `fecha_alta_puesto` date DEFAULT NULL,
  `horas_trabajadas` decimal(7,2) DEFAULT NULL,
  `horas_feriados` decimal(7,2) DEFAULT NULL,
  `horas_extras_autorizadas` tinyint(1) NOT NULL DEFAULT '0',
  `horas_extras_cantidad` decimal(7,2) DEFAULT NULL,
  `apercibimiento` tinyint(1) NOT NULL DEFAULT '0',
  `apercibimiento_motivo` text DEFAULT NULL,
  `apercibimiento_archivo_url` text DEFAULT NULL,
  `apercibimiento_archivo_nombre` varchar(255) DEFAULT NULL,
  `suspension` tinyint(1) NOT NULL DEFAULT '0',
  `suspension_motivo` text DEFAULT NULL,
  `suspension_archivo_url` text DEFAULT NULL,
  `suspension_archivo_nombre` varchar(255) DEFAULT NULL,
  `descuento` tinyint(1) NOT NULL DEFAULT '0',
  `descuento_monto` decimal(12,2) DEFAULT NULL,
  `descuento_motivo` text DEFAULT NULL,
  `aus_just` tinyint(1) NOT NULL DEFAULT '0',
  `aus_just_cantidad` decimal(7,2) DEFAULT NULL,
  `aus_just_unidad` enum('horas','minutos') NOT NULL DEFAULT 'horas',
  `aus_just_motivo` text DEFAULT NULL,
  `aus_injust_cantidad` decimal(7,2) DEFAULT NULL,
  `aus_injust_unidad` enum('horas','minutos') NOT NULL DEFAULT 'horas',
  `aus_injust_motivo` text DEFAULT NULL,
  `tardanzas` tinyint(1) NOT NULL DEFAULT '0',
  `tardanzas_cantidad` decimal(7,2) DEFAULT NULL,
  `tardanzas_unidad` enum('horas','minutos') NOT NULL DEFAULT 'horas',
  `tardanzas_motivo` text DEFAULT NULL,
  `incentivos` json DEFAULT NULL,
  `observaciones` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nov_emp_solicitud` (`solicitud_id`),
  KEY `idx_nov_emp_personal` (`personal_id`),
  CONSTRAINT `fk_nov_emp_solicitud`
    FOREIGN KEY (`solicitud_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_nov_emp_personal`
    FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.17 rrhh_motivos_baja
CREATE TABLE IF NOT EXISTS `rrhh_motivos_baja` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sucursal_id` int NOT NULL,
  `nombre` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `orden` smallint NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `rrhh_motivos_baja_sucursal_fk` (`sucursal_id`),
  CONSTRAINT `rrhh_motivos_baja_sucursal_fk`
    FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.18 rrhh_sueldos_periodo_ajustes (sin las columnas de "envío a pagos" —
--      las agrega la Parte 4)
CREATE TABLE IF NOT EXISTS `rrhh_sueldos_periodo_ajustes` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `personal_id` int NOT NULL,
  `sucursal_id` int NOT NULL,
  `mes` tinyint unsigned NOT NULL,
  `anio` smallint unsigned NOT NULL,
  `aplica_valor_hora` tinyint(1) NOT NULL DEFAULT 1,
  `aplica_sueldo_basico_escala` tinyint(1) NOT NULL DEFAULT 1,
  `aplica_horas_extra` tinyint(1) NOT NULL DEFAULT 0,
  `aplica_incentivos` tinyint(1) NOT NULL DEFAULT 1,
  `aplica_banco` tinyint(1) NOT NULL DEFAULT 0,
  `hs_realizadas_mes` decimal(10, 2) DEFAULT NULL,
  `valor_hora` decimal(12, 2) DEFAULT NULL,
  `sueldo_basico` decimal(12, 2) DEFAULT NULL,
  `horas_extra_50` decimal(12, 2) DEFAULT NULL,
  `horas_extra_hs` decimal(10, 2) DEFAULT NULL,
  `horas_feriado` decimal(12, 2) DEFAULT NULL,
  `horas_feriado_hs` decimal(10, 2) DEFAULT NULL,
  `incentivos` decimal(12, 2) DEFAULT NULL,
  `incentivos_seleccionados` text DEFAULT NULL,
  `extras` decimal(12, 2) DEFAULT NULL,
  `ausencias_justificadas` decimal(10, 2) DEFAULT NULL,
  `ausencias_injustificadas` decimal(10, 2) DEFAULT NULL,
  `tardanzas` decimal(10, 2) DEFAULT NULL,
  `descuentos` decimal(12, 2) DEFAULT NULL,
  `adelantos` decimal(12, 2) DEFAULT NULL,
  `sueldo_sac` decimal(12, 2) DEFAULT NULL,
  `sueldo_neto` decimal(12, 2) DEFAULT NULL,
  `banco` decimal(12, 2) DEFAULT NULL,
  `efectivo` decimal(12, 2) DEFAULT NULL,
  `fecha_deposito` date DEFAULT NULL,
  `sueldo_pagado` tinyint(1) NOT NULL DEFAULT 0,
  `comentario_cobro` text DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `rrhh_sueldos_ajuste_periodo_unique` (`personal_id`, `mes`, `anio`),
  KEY `idx_rrhh_sueldos_ajuste_sucursal_periodo` (`sucursal_id`, `mes`, `anio`),
  CONSTRAINT `fk_rrhh_sueldos_ajuste_personal`
    FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rrhh_sueldos_ajuste_sucursal`
    FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- 4. DATOS INICIALES — motivos de baja por sucursal ----
INSERT INTO `rrhh_motivos_baja` (`sucursal_id`, `nombre`, `orden`)
SELECT s.id, m.nombre, m.orden
FROM `sucursales` s
CROSS JOIN (
  SELECT 'Desvinculación'       AS nombre, 10 AS orden UNION ALL
  SELECT 'Renuncia voluntaria',             20         UNION ALL
  SELECT 'Despido sin causa',               30         UNION ALL
  SELECT 'Despido con causa',               40         UNION ALL
  SELECT 'Fin período de prueba',           50         UNION ALL
  SELECT 'Fin contrato temporal',           60         UNION ALL
  SELECT 'Jubilación',                      70         UNION ALL
  SELECT 'Mutuo acuerdo',                   80
) m
WHERE s.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM `rrhh_motivos_baja` mb
    WHERE mb.sucursal_id = s.id AND mb.nombre = m.nombre
  );

-- ---- 6. ASIGNACIÓN DE roles_permisos ----

-- superadmin: todos los permisos nuevos
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r, `permisos` p
WHERE r.nombre = 'superadmin'
  AND p.clave IN (
    'ver_areas', 'gestionar_areas',
    'ver_personal', 'crear_personal', 'gestionar_personal', 'eliminar_personal',
    'ver_puestos', 'gestionar_puestos',
    'ver_escalas', 'gestionar_escalas',
    'ver_calendario', 'gestionar_calendario',
    'ver_solicitudes', 'crear_solicitudes', 'editar_solicitudes', 'cancelar_solicitudes',
    'ver_historial_solicitudes_global'
  );

-- admin: todos los nuevos + permisos base que le corresponden
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN (
  'ver_areas', 'gestionar_areas',
  'ver_personal', 'crear_personal', 'gestionar_personal', 'eliminar_personal',
  'ver_puestos', 'gestionar_puestos',
  'ver_escalas', 'gestionar_escalas',
  'ver_calendario', 'gestionar_calendario',
  'ver_solicitudes', 'crear_solicitudes', 'editar_solicitudes', 'cancelar_solicitudes'
)
WHERE r.nombre = 'admin';

-- gerente: permisos base + RRHH completo excepto eliminar personal
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN (
  'ver_pendientes', 'cargar_pendientes', 'ver_sucursales',
  'ver_areas', 'gestionar_areas',
  'ver_personal', 'crear_personal', 'gestionar_personal',
  'ver_puestos', 'gestionar_puestos',
  'ver_escalas', 'gestionar_escalas',
  'ver_calendario', 'gestionar_calendario',
  'ver_solicitudes', 'crear_solicitudes', 'editar_solicitudes', 'cancelar_solicitudes'
)
WHERE r.nombre = 'gerente';

-- directivo: solo lectura en todos los módulos nuevos
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN (
  'ver_areas',
  'ver_personal',
  'ver_puestos',
  'ver_escalas',
  'ver_calendario',
  'ver_solicitudes',
  'ver_historial_solicitudes_global'
)
WHERE r.nombre = 'directivo';


-- ============================================================================
-- PARTE 2/8 — RH-LiqFinal_ajustes.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS `rrhh_liquidaciones_finales_ajustes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `liquidacion_id` int NOT NULL,
  `aplica_valor_hora` tinyint(1) DEFAULT 0,
  `aplica_sueldo_basico_escala` tinyint(1) DEFAULT 1,
  `aplica_banco` tinyint(1) DEFAULT 1,
  `aplica_horas_extra` tinyint(1) DEFAULT 0,
  `aplica_incentivos` tinyint(1) DEFAULT 1,
  `valor_hora` decimal(12,2) DEFAULT NULL,
  `sueldo_basico` decimal(12,2) DEFAULT NULL,
  `horas_extra_50` decimal(12,2) DEFAULT NULL,
  `horas_extra_hs` decimal(10,4) DEFAULT NULL,
  `horas_feriado` decimal(12,2) DEFAULT NULL,
  `horas_feriado_hs` decimal(10,4) DEFAULT NULL,
  `incentivos` decimal(12,2) DEFAULT NULL,
  `incentivos_seleccionados` json DEFAULT NULL,
  `extras` decimal(12,2) DEFAULT NULL,
  `ausencias_justificadas` decimal(12,2) DEFAULT NULL,
  `ausencias_injustificadas` decimal(12,2) DEFAULT NULL,
  `tardanzas` decimal(12,2) DEFAULT NULL,
  `descuentos` decimal(12,2) DEFAULT NULL,
  `adelantos` decimal(12,2) DEFAULT NULL,
  `sueldo_neto` decimal(12,2) DEFAULT NULL,
  `banco` decimal(12,2) DEFAULT NULL,
  `efectivo` decimal(12,2) DEFAULT NULL,
  `sac_porcentaje` decimal(8,4) DEFAULT NULL,
  `sac_importe` decimal(12,2) DEFAULT NULL,
  `vng_porcentaje` decimal(8,4) DEFAULT NULL,
  `vng_importe` decimal(12,2) DEFAULT NULL,
  `preaviso_porcentaje` decimal(8,4) DEFAULT NULL,
  `preaviso_importe` decimal(12,2) DEFAULT NULL,
  `total_liq` decimal(12,2) DEFAULT NULL,
  `liq_banco` decimal(12,2) DEFAULT NULL,
  `liq_efectivo` decimal(12,2) DEFAULT NULL,
  `total_general` decimal(12,2) DEFAULT NULL,
  `sueldo_pagado` tinyint(1) DEFAULT 0,
  `fecha_deposito` date DEFAULT NULL,
  `comentario_cobro` text DEFAULT NULL,
  `ministerio_aplica` tinyint(1) DEFAULT 0,
  `ministerio_direccion` varchar(500) DEFAULT NULL,
  `ministerio_fecha` date DEFAULT NULL,
  `ministerio_horario` varchar(100) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `liq_finales_ajustes_liq_id_unique` (`liquidacion_id`),
  CONSTRAINT `liq_finales_ajustes_fk` FOREIGN KEY (`liquidacion_id`) REFERENCES `rrhh_liquidaciones_finales` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- PARTE 3/8 — RH-LiqFinal_envio_calendario.sql (con guards de idempotencia)
-- ============================================================================
SET @schema_name = DATABASE();

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE rrhh_liquidaciones_finales_ajustes ADD COLUMN calendario_evento_id int DEFAULT NULL AFTER ministerio_horario',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'rrhh_liquidaciones_finales_ajustes' AND COLUMN_NAME = 'calendario_evento_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE rrhh_liquidaciones_finales_ajustes ADD COLUMN enviado_pagos tinyint(1) NOT NULL DEFAULT 0 AFTER calendario_evento_id',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'rrhh_liquidaciones_finales_ajustes' AND COLUMN_NAME = 'enviado_pagos'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE rrhh_liquidaciones_finales_ajustes ADD COLUMN fecha_enviado_pagos datetime DEFAULT NULL AFTER enviado_pagos',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'rrhh_liquidaciones_finales_ajustes' AND COLUMN_NAME = 'fecha_enviado_pagos'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE rrhh_liquidaciones_finales_ajustes ADD COLUMN movimiento_banco_id int DEFAULT NULL AFTER fecha_enviado_pagos',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'rrhh_liquidaciones_finales_ajustes' AND COLUMN_NAME = 'movimiento_banco_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE rrhh_liquidaciones_finales_ajustes ADD COLUMN movimiento_efectivo_id int DEFAULT NULL AFTER movimiento_banco_id',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'rrhh_liquidaciones_finales_ajustes' AND COLUMN_NAME = 'movimiento_efectivo_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ============================================================================
-- PARTE 4/8 — RH-Sueldos_envio_pagos.sql (con guards de idempotencia)
-- ============================================================================
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN enviado_pagos tinyint(1) NOT NULL DEFAULT 0 AFTER comentario_cobro',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes' AND COLUMN_NAME = 'enviado_pagos'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN fecha_enviado_pagos datetime DEFAULT NULL AFTER enviado_pagos',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes' AND COLUMN_NAME = 'fecha_enviado_pagos'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN movimiento_banco_id int DEFAULT NULL AFTER fecha_enviado_pagos',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes' AND COLUMN_NAME = 'movimiento_banco_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN movimiento_efectivo_id int DEFAULT NULL AFTER movimiento_banco_id',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes' AND COLUMN_NAME = 'movimiento_efectivo_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ============================================================================
-- PARTE 5/8 — RH-64_add_sucursal_to_escalas_salariales.sql (con guards)
-- ============================================================================

-- Paso 1: agregar la columna como nullable (si no existe)
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE escalas_salariales ADD COLUMN sucursal_id INT NULL AFTER id',
  'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'escalas_salariales' AND COLUMN_NAME = 'sucursal_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Paso 2: backfill de registros existentes a la primera sucursal activa
-- (no-op si ya no quedan filas NULL)
UPDATE escalas_salariales
SET sucursal_id = (SELECT id FROM sucursales WHERE activo = 1 ORDER BY id ASC LIMIT 1)
WHERE sucursal_id IS NULL;

-- Paso 3: NOT NULL + FK + índice (solo si la FK todavía no existe)
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @schema_name
    AND TABLE_NAME = 'escalas_salariales'
    AND CONSTRAINT_NAME = 'escalas_sucursal_fk'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE escalas_salariales MODIFY COLUMN sucursal_id INT NOT NULL, ADD CONSTRAINT escalas_sucursal_fk FOREIGN KEY (sucursal_id) REFERENCES sucursales (id) ON DELETE RESTRICT, ADD INDEX idx_sucursal_periodo (sucursal_id, mes, anio)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ============================================================================
-- PARTE 6/8 — personal_documentos.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS personal_documentos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  personal_id   INT          NOT NULL,
  label         VARCHAR(255) NOT NULL,
  url           VARCHAR(1000) NOT NULL,
  nombre_original VARCHAR(500) NULL,
  subido_por_id   INT NULL,
  subido_por_nombre VARCHAR(255) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at    TIMESTAMP NULL,
  INDEX idx_personal_documentos_personal_id (personal_id)
);


-- ============================================================================
-- PARTE 7/8 — RH-65_modulos_acceso.sql
-- ============================================================================

-- Paso 1: Catálogo de módulos (redundante con syncModulos(), inofensivo)
CREATE TABLE IF NOT EXISTS `modulos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `clave` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clave` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `modulos` (`clave`, `nombre`, `descripcion`) VALUES
  ('tesoreria',        'Tesorería',        'Sucursales, movimientos de caja, pagos pendientes y reportes'),
  ('recursos_humanos', 'Recursos Humanos', 'Personal, legajos, escalas, sueldos, solicitudes y calendario')
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `descripcion` = VALUES(`descripcion`);

-- Paso 2: Tabla intermedia usuarios_modulos (acceso por usuario)
CREATE TABLE IF NOT EXISTS `usuarios_modulos` (
  `usuario_id` int NOT NULL,
  `modulo_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`usuario_id`, `modulo_id`),
  CONSTRAINT `um_usuario_fk` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `um_modulo_fk` FOREIGN KEY (`modulo_id`) REFERENCES `modulos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Paso 3: Backfill de accesos — otorga a cada usuario los módulos a los que
-- YA tenía acceso según los permisos de su rol actual (nadie pierde acceso).

-- Tesorería: usuarios cuyo rol tiene algún permiso de tesorería.
INSERT IGNORE INTO `usuarios_modulos` (`usuario_id`, `modulo_id`)
SELECT u.id, m.id
FROM `usuarios` u
JOIN `roles_permisos` rp ON rp.rol_id = u.rol_id
JOIN `permisos` p ON p.id = rp.permiso_id
JOIN `modulos` m ON m.clave = 'tesoreria'
WHERE p.categoria IN ('Movimientos', 'Pendientes', 'Sucursales', 'Reportes')
GROUP BY u.id, m.id;

-- Recursos Humanos: usuarios cuyo rol tiene algún permiso de RRHH.
INSERT IGNORE INTO `usuarios_modulos` (`usuario_id`, `modulo_id`)
SELECT u.id, m.id
FROM `usuarios` u
JOIN `roles_permisos` rp ON rp.rol_id = u.rol_id
JOIN `permisos` p ON p.id = rp.permiso_id
JOIN `modulos` m ON m.clave = 'recursos_humanos'
WHERE p.categoria = 'Recursos Humanos'
GROUP BY u.id, m.id;

-- IMPORTANTE: superadmin tiene bypass total de módulos en el código
-- (requireModule), así que no necesita fila en usuarios_modulos. Si en tu
-- DB hay usuarios superadmin y querés que igual aparezcan marcados con
-- acceso a todo por prolijidad, descomentá esto:
--
-- INSERT IGNORE INTO `usuarios_modulos` (`usuario_id`, `modulo_id`)
-- SELECT u.id, m.id FROM `usuarios` u JOIN `roles` r ON r.id = u.rol_id CROSS JOIN `modulos` m
-- WHERE r.nombre = 'superadmin';


-- ============================================================================
-- PARTE 8/8 — RH-66_revertir_escalacion_admin.sql
-- ============================================================================
-- Sólo elimina; no agrega. Restaura 'admin' al set de permisos documentado
-- (base Tesorería + RRHH operativo, SIN sueldos/incentivos/aprobar/eliminar).
DELETE rp
FROM `roles_permisos` rp
JOIN `roles` r ON r.id = rp.rol_id
JOIN `permisos` p ON p.id = rp.permiso_id
WHERE r.nombre = 'admin'
  AND p.clave NOT IN (
    'ver_pendientes',
    'cargar_pendientes',
    'ver_sucursales',
    'ver_areas',
    'gestionar_areas',
    'ver_personal',
    'crear_personal',
    'gestionar_personal',
    'eliminar_personal',
    'ver_puestos',
    'gestionar_puestos',
    'ver_escalas',
    'gestionar_escalas',
    'ver_calendario',
    'gestionar_calendario',
    'ver_solicitudes',
    'crear_solicitudes',
    'editar_solicitudes',
    'cancelar_solicitudes'
  );

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- FIN — próximo paso: reiniciar la API para que syncPermisos()/syncModulos()
-- terminen de sincronizar `permisos` y `modulos` (incluye ver_incentivos,
-- gestionar_incentivos, aprobar_solicitudes, ver_sueldos,
-- ver_solicitudes_todas_sucursales, que hoy sólo usa 'superadmin').
-- ============================================================================
