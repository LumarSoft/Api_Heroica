-- Migración RH-64: Agregar sucursal_id a escalas_salariales
-- Fecha: 2026-06-08
-- Descripción: Las escalas salariales son por sucursal; cada una puede tener
--              escalas distintas para el mismo puesto y período.

-- Paso 1: agregar la columna como nullable (sin FK todavía, para no romper filas existentes)
ALTER TABLE escalas_salariales
  ADD COLUMN sucursal_id INT NULL AFTER id;

-- Paso 2: asignar los registros existentes a la primera sucursal activa.
--         Si querés asignarlos a una sucursal específica, reemplazá la subquery
--         por el ID que corresponda: UPDATE escalas_salariales SET sucursal_id = <ID> WHERE sucursal_id IS NULL;
UPDATE escalas_salariales
SET sucursal_id = (SELECT id FROM sucursales WHERE activo = 1 ORDER BY id ASC LIMIT 1)
WHERE sucursal_id IS NULL;

-- Paso 3: convertir a NOT NULL y agregar FK + índice
ALTER TABLE escalas_salariales
  MODIFY COLUMN sucursal_id INT NOT NULL,
  ADD CONSTRAINT escalas_sucursal_fk
    FOREIGN KEY (sucursal_id) REFERENCES sucursales (id) ON DELETE RESTRICT,
  ADD INDEX idx_sucursal_periodo (sucursal_id, mes, anio);
