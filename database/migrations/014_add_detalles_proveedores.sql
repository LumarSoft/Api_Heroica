-- Migración 014: Agregar datos extendidos a proveedores
-- Fecha: 2026-04-15
-- Descripción: Agrega campos opcionales para almacenar información adicional
--              de proveedores, visible en "Ver más datos" de Configuración.

ALTER TABLE `proveedores`
  ADD COLUMN `razon_social` VARCHAR(255) NULL AFTER `nombre`,
  ADD COLUMN `cuit` VARCHAR(20) NULL AFTER `razon_social`,
  ADD COLUMN `cbu_alias` VARCHAR(100) NULL AFTER `cuit`,
  ADD COLUMN `telefono` VARCHAR(50) NULL AFTER `cbu_alias`,
  ADD COLUMN `email` VARCHAR(255) NULL AFTER `telefono`,
  ADD COLUMN `direccion` VARCHAR(255) NULL AFTER `email`;
