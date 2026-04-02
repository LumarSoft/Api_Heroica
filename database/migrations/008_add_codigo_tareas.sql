-- Migración 008: Agregar columna codigo, deleted_at y modificar estados
-- Fecha: 2026-04-02

-- Agregar columna codigo
ALTER TABLE tareas ADD COLUMN codigo VARCHAR(20) NULL AFTER id;

-- Actualizar tareas existentes con códigos correlativos
UPDATE tareas t
JOIN (
  SELECT id, CONCAT('TE-', LPAD(ROW_NUMBER() OVER (ORDER BY id), 2, '0')) AS nuevo_codigo
  FROM tareas
) AS numeradas ON t.id = numeradas.id
SET t.codigo = numeradas.nuevo_codigo;

-- Verificar que no haya NULLs antes de hacer la columna NOT NULL
UPDATE tareas SET codigo = CONCAT('TE-', LPAD(id, 2, '0')) WHERE codigo IS NULL;

-- Hacer la columna codigo NOT NULL y UNIQUE después de tener valores
ALTER TABLE tareas MODIFY COLUMN codigo VARCHAR(20) NOT NULL;
ALTER TABLE tareas ADD UNIQUE KEY unique_codigo (codigo);

-- Agregar columna deleted_at para soft delete
ALTER TABLE tareas ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER completed_at;

-- Modificar el ENUM de estado: eliminar 'cancelado' y agregar 'en_pruebas'
-- Primero actualizar las tareas canceladas a deleted_at
UPDATE tareas SET deleted_at = NOW() WHERE estado = 'cancelado';

-- Modificar la columna estado
ALTER TABLE tareas MODIFY COLUMN estado ENUM('pendiente', 'en_progreso', 'en_pruebas', 'completado') NOT NULL DEFAULT 'pendiente';
