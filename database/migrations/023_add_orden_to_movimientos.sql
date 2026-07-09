-- Migración 023: Agregar columna `orden` a la tabla movimientos
-- Fecha: 2026-07-08
-- Descripción: Permite posicionar manualmente un movimiento respecto de otro
--              (creación "en línea" con Agregar arriba / Agregar debajo).
--              Es un valor de posición fraccional (DOUBLE) que habilita insertar
--              un movimiento ENTRE otros dos. Cuando es NULL, el frontend usa el
--              `id` como orden de respaldo, por lo que los movimientos existentes
--              y los creados por otros flujos no requieren backfill.

ALTER TABLE `movimientos`
  ADD COLUMN `orden` DOUBLE NULL DEFAULT NULL
    COMMENT 'Posición manual del movimiento dentro de su fecha (fallback: id)'
  AFTER `fecha`;
