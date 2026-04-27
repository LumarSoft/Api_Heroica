-- Migración 021: Agregar módulo a tareas y asegurar AUTO_INCREMENT en la PK
-- Fecha: 2026-04-27

ALTER TABLE tareas MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT;

ALTER TABLE tareas ADD COLUMN modulo VARCHAR(50) NOT NULL DEFAULT 'tesoreria' AFTER codigo;

ALTER TABLE tareas ADD INDEX idx_tareas_modulo_codigo (modulo, codigo);
