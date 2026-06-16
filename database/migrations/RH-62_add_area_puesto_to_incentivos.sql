-- Migración RH-62: Scope por área o puesto en incentivos
-- Fecha: 2026-05-26
-- Descripción: Permite que un incentivo se aplique a toda la sucursal (null/null),
--              a un área específica (area_id) o a un puesto específico (puesto_id).

ALTER TABLE rrhh_incentivos_premios
  ADD COLUMN area_id  INT NULL DEFAULT NULL AFTER sucursal_id,
  ADD COLUMN puesto_id INT NULL DEFAULT NULL AFTER area_id,
  ADD CONSTRAINT fk_rrhh_incentivos_area   FOREIGN KEY (area_id)   REFERENCES areas(id)   ON DELETE RESTRICT,
  ADD CONSTRAINT fk_rrhh_incentivos_puesto FOREIGN KEY (puesto_id) REFERENCES puestos(id) ON DELETE RESTRICT,
  ADD INDEX idx_rrhh_incentivos_area   (area_id),
  ADD INDEX idx_rrhh_incentivos_puesto (puesto_id);
