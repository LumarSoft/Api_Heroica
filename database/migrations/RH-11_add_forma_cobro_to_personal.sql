-- Migración RH-50: forma de cobro del colaborador (banco / efectivo)
-- Fecha: 2026-05-01

ALTER TABLE `personal`
  ADD COLUMN `forma_cobro` ENUM('banco', 'efectivo') NOT NULL DEFAULT 'banco' AFTER `activo`;
