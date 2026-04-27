-- Migración 021: Tabla de escalas salariales
-- Fecha: 2026-04-27
-- Descripción: Puestos de trabajo con sueldo base, valor por hora y período (mes/año).

CREATE TABLE IF NOT EXISTS escalas_salariales (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  puesto      VARCHAR(150)      NOT NULL,
  sueldo_base DECIMAL(12, 2)    NOT NULL,
  mes         TINYINT UNSIGNED  NOT NULL COMMENT 'Mes (1-12)',
  anio        SMALLINT UNSIGNED NOT NULL COMMENT 'Año',
  valor_hora  DECIMAL(10, 2)    NULL DEFAULT NULL COMMENT 'Valor por hora',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP NULL DEFAULT NULL COMMENT 'Eliminación lógica; NULL = activo',
  INDEX idx_periodo (mes, anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
