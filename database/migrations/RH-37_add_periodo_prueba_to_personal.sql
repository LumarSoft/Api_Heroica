-- Migración RH-37: marcar colaboradores con período de prueba
-- Fecha: 2026-04-30

ALTER TABLE `personal`
  ADD COLUMN `periodo_prueba` tinyint(1) NOT NULL DEFAULT 0 AFTER `fecha_incorporacion`,
  ADD COLUMN `periodo_prueba_dias` int DEFAULT NULL AFTER `periodo_prueba`;
