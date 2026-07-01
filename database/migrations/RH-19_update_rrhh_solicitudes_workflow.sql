-- Migración RH-19: trazabilidad, aprobaciones y efectos automáticos de solicitudes RRHH
-- Fecha: 2026-04-29

ALTER TABLE `rrhh_solicitudes`
  ADD COLUMN `resuelto_por_usuario_id` int DEFAULT NULL AFTER `usuario_id`,
  ADD COLUMN `fecha_resolucion` datetime DEFAULT NULL AFTER `fecha_solicitud`,
  ADD COLUMN `motivo_resolucion` text DEFAULT NULL AFTER `observaciones`,
  ADD COLUMN `personal_creado_id` int DEFAULT NULL AFTER `personal_id`,
  ADD COLUMN `liquidacion_final_estado` enum('Pendiente', 'Generada', 'No aplica', 'Error') NOT NULL DEFAULT 'No aplica' AFTER `motivo_resolucion`,
  ADD CONSTRAINT `rrhh_solicitudes_resuelto_por_fk` FOREIGN KEY (`resuelto_por_usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `rrhh_solicitudes_personal_creado_fk` FOREIGN KEY (`personal_creado_id`) REFERENCES `personal` (`id`) ON DELETE RESTRICT;

CREATE TABLE `rrhh_solicitudes_historial` (
  `id` int NOT NULL AUTO_INCREMENT,
  `solicitud_id` int NOT NULL,
  `personal_id` int DEFAULT NULL,
  `usuario_id` int DEFAULT NULL,
  `evento` enum('Creada', 'Aprobada', 'Rechazada', 'Cancelada', 'Legajo creado', 'Legajo desactivado', 'Liquidacion final generada', 'Error de liquidacion final') NOT NULL,
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

CREATE TABLE `rrhh_liquidaciones_finales` (
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
