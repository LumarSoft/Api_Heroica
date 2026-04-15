-- Agrega columna asignado_a a la tabla tareas para permitir asignar tareas a usuarios
ALTER TABLE tareas
  ADD COLUMN asignado_a INT NULL AFTER creado_por,
  ADD CONSTRAINT fk_tareas_asignado_a FOREIGN KEY (asignado_a) REFERENCES usuarios(id) ON DELETE SET NULL;
