-- Migración RH-36: alertas de período de prueba por vencer
-- Fecha: 2026-04-30

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
