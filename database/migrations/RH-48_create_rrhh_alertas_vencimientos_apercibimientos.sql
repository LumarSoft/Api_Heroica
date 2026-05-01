-- Migración RH-38: alertas RRHH por segundo apercibimiento y vencimientos
-- Fecha: 2026-04-30

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
