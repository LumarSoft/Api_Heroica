-- Migración 018: Soft-delete en tabla descripciones
-- Fecha: 2026-04-20
-- Descripción: Agrega la columna deleted_at para eliminación lógica,
--              evitando borrar registros referenciados en movimientos históricos.

ALTER TABLE `descripciones`
  ADD COLUMN `deleted_at` TIMESTAMP NULL DEFAULT NULL
    COMMENT 'Fecha de eliminación lógica; NULL = activo'
  AFTER `updated_at`;
