-- Migración HAI-01: HeroicAI — persistencia de conversaciones
-- Fecha: 2026-07-04
-- Descripción:
--   Tablas para guardar el historial del asistente HeroicAI por usuario.
--   Estas tablas también se crean automáticamente al arrancar la API
--   (ensureHeroicaiTables() en src/config/heroicai/schema.ts), por lo que
--   esta migración es solo para dejar el esquema registrado en el repo.

CREATE TABLE IF NOT EXISTS `heroicai_conversaciones` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `usuario_id` INT NOT NULL,
  `titulo`     VARCHAR(255) NOT NULL DEFAULT 'Nueva consulta',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  INDEX `idx_heroicai_conv_usuario` (`usuario_id`, `deleted_at`),
  CONSTRAINT `heroicai_conv_usuario_fk` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `heroicai_mensajes` (
  `id`              INT AUTO_INCREMENT PRIMARY KEY,
  `conversacion_id` INT NOT NULL,
  `rol`             ENUM('user', 'assistant') NOT NULL,
  `contenido`       TEXT NOT NULL,
  `created_at`      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_heroicai_msg_conv` (`conversacion_id`),
  CONSTRAINT `heroicai_msg_conv_fk` FOREIGN KEY (`conversacion_id`) REFERENCES `heroicai_conversaciones` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
