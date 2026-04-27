-- Migración 022: Normalizar módulos de tareas a solo tesoreria | rh
-- Fecha: 2026-04-27

UPDATE tareas
SET modulo = 'tesoreria'
WHERE modulo NOT IN ('tesoreria', 'rh');

ALTER TABLE tareas MODIFY COLUMN modulo VARCHAR(50) NOT NULL DEFAULT 'tesoreria';
