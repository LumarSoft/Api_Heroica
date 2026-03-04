-- Migración: Agregar columna 'tipo' a la tabla 'categorias'
-- Fecha: 2026-03-04

ALTER TABLE `categorias` 
ADD COLUMN `tipo` ENUM('ingreso', 'egreso') NOT NULL DEFAULT 'egreso';

-- Actualizar categorías existentes de ingreso comunes
UPDATE `categorias` 
SET `tipo` = 'ingreso' 
WHERE UPPER(`nombre`) IN ('VENTA', 'VENTAS', 'HONORARIOS', 'COBROS');
