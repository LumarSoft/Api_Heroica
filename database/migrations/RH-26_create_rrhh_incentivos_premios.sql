-- Migración 026: Tabla de incentivos y premios de RRHH
-- Fecha: 2026-04-27
-- Descripción: Incentivos/premios por sucursal, período y escala salarial.

CREATE TABLE IF NOT EXISTS rrhh_incentivos_premios (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  sucursal_id         INT               NOT NULL,
  escala_salarial_id  INT               NULL DEFAULT NULL,
  nombre              VARCHAR(150)      NOT NULL,
  tipo                ENUM('Incentivo', 'Premio') NOT NULL DEFAULT 'Incentivo',
  descripcion         TEXT              NULL DEFAULT NULL,
  mes                 TINYINT UNSIGNED  NOT NULL COMMENT 'Mes (1-12)',
  anio                SMALLINT UNSIGNED NOT NULL COMMENT 'Año',
  metodo_calculo      ENUM('porcentaje_escala', 'monto_fijo', 'multiplicador_valor_hora') NOT NULL DEFAULT 'porcentaje_escala',
  valor               DECIMAL(12, 2)    NOT NULL COMMENT 'Porcentaje, monto fijo o cantidad de horas segun metodo_calculo',
  activo              TINYINT(1)        NOT NULL DEFAULT 1,
  fecha_ultima_actualizacion TIMESTAMP  DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at          TIMESTAMP         DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP         DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at          TIMESTAMP         NULL DEFAULT NULL,
  INDEX idx_rrhh_incentivos_periodo (sucursal_id, mes, anio),
  INDEX idx_rrhh_incentivos_escala (escala_salarial_id),
  CONSTRAINT fk_rrhh_incentivos_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id),
  CONSTRAINT fk_rrhh_incentivos_escala FOREIGN KEY (escala_salarial_id) REFERENCES escalas_salariales(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
