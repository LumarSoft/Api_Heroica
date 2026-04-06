-- Migración 009: Agregar version a tareas
-- Fecha: 2026-04-06

ALTER TABLE tareas ADD COLUMN version VARCHAR(255) NULL;
