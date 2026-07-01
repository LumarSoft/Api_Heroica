-- RH-60: Persistir en `personal` todos los datos de la ficha de alta RRHH al aprobar solicitud
-- Fecha: 2026-05-04

ALTER TABLE `personal`
  ADD COLUMN `cuil` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `dni`,
  ADD COLUMN `telefono` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `email`,
  ADD COLUMN `fecha_nacimiento` date DEFAULT NULL AFTER `telefono`,
  ADD COLUMN `domicilio_real` text COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Dirección real' AFTER `fecha_nacimiento`,
  ADD COLUMN `domicilio_dni` text COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Domicilio según DNI' AFTER `domicilio_real`,
  ADD COLUMN `fecha_inicio_cobro` date DEFAULT NULL COMMENT 'Inicio cobro en oficina' AFTER `fecha_incorporacion`,
  ADD COLUMN `jornada_semanal_dias` tinyint unsigned DEFAULT NULL AFTER `periodo_prueba_dias`,
  ADD COLUMN `jornada_diaria_horas` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `jornada_semanal_dias`,
  ADD COLUMN `propuesta_economica` decimal(14,2) DEFAULT NULL COMMENT 'Remuneración acordada al alta' AFTER `jornada_diaria_horas`,
  ADD COLUMN `beneficios` text COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `propuesta_economica`,
  ADD COLUMN `condicion_laboral` tinyint unsigned DEFAULT NULL COMMENT 'Condición laboral 1 o 2' AFTER `beneficios`,
  ADD COLUMN `fecha_alta_temprana` date DEFAULT NULL AFTER `condicion_laboral`,
  ADD COLUMN `banco` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `fecha_alta_temprana`,
  ADD COLUMN `cbu` varchar(22) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `banco`,
  ADD COLUMN `carnet_archivo_url` text COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `carnet_manipulacion_alimentos`,
  ADD COLUMN `carnet_archivo_nombre` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `carnet_archivo_url`,
  ADD COLUMN `carnet_vencimiento` date DEFAULT NULL AFTER `carnet_archivo_nombre`,
  ADD COLUMN `solicitud_alta_id` int DEFAULT NULL AFTER `carnet_vencimiento`,
  ADD COLUMN `datos_alta_json` json DEFAULT NULL COMMENT 'Snapshot completo validado de rrhh_solicitudes.detalles (tipo Altas)' AFTER `solicitud_alta_id`,
  ADD KEY `idx_personal_solicitud_alta` (`solicitud_alta_id`),
  ADD CONSTRAINT `personal_solicitud_alta_fk` FOREIGN KEY (`solicitud_alta_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE SET NULL;
