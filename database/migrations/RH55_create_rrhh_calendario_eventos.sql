-- Migración 023: Crear eventos del calendario global de RRHH
-- Fecha: 2026-04-27

CREATE TABLE IF NOT EXISTS rrhh_calendario_eventos (
  id INT NOT NULL AUTO_INCREMENT,
  evento VARCHAR(120) NOT NULL,
  fecha DATE NOT NULL,
  hora TIME NULL,
  direccion VARCHAR(255) NULL,
  participantes TEXT NULL,
  comentarios TEXT NULL,
  tipo_notion VARCHAR(80) NOT NULL DEFAULT 'General',
  creado_por INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  INDEX idx_rrhh_calendario_fecha (fecha),
  INDEX idx_rrhh_calendario_deleted_at (deleted_at),
  CONSTRAINT fk_rrhh_calendario_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    ON DELETE SET NULL
);
