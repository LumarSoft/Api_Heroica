CREATE TABLE IF NOT EXISTS personal_documentos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  personal_id   INT          NOT NULL,
  label         VARCHAR(255) NOT NULL,
  url           VARCHAR(1000) NOT NULL,
  nombre_original VARCHAR(500) NULL,
  subido_por_id   INT NULL,
  subido_por_nombre VARCHAR(255) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at    TIMESTAMP NULL,
  INDEX idx_personal_documentos_personal_id (personal_id)
);
