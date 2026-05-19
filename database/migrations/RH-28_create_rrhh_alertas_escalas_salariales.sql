-- Migración RH-60: alertas de escalas salariales desactualizadas
-- Fecha: 2026-05-01

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
