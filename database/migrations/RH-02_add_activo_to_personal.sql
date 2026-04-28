-- Migración RH-02: Agregar campo activo a personal
-- Fecha: 2026-04-27
-- Permite marcar colaboradores como activos/inactivos sin eliminarlos

ALTER TABLE `personal`
  ADD COLUMN `activo` tinyint(1) NOT NULL DEFAULT 1
  AFTER `carnet_manipulacion_alimentos`;
