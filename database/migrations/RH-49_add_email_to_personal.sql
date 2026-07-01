-- Migración RH-49: email de contacto del colaborador
-- Fecha: 2026-05-01

ALTER TABLE `personal`
  ADD COLUMN `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `dni`;
