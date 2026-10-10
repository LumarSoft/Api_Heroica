-- REP-01: plantilla global del "Corte de balance mensual" (módulo Reportes).
-- Guarda en JSON cómo se agrupan los egresos del sistema en secciones y líneas
-- del reporte (qué categorías / subcategorías / descripciones suma cada línea).
-- Mientras no exista una fila, la API usa una plantilla por defecto armada a
-- partir del Corte de balance de Julio 2026 (Canva).

CREATE TABLE IF NOT EXISTS reportes_plantillas (
  id INT NOT NULL AUTO_INCREMENT,
  clave VARCHAR(50) NOT NULL,
  config JSON NOT NULL,
  updated_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY reportes_plantillas_clave_uk (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
