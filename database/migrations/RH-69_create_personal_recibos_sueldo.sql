CREATE TABLE personal_recibos_sueldo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  personal_id INT NOT NULL,
  mes TINYINT NOT NULL,
  anio SMALLINT NOT NULL,
  url VARCHAR(1000) NOT NULL,
  nombre_original VARCHAR(500) NULL,
  subido_por_id INT NULL,
  subido_por_nombre VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_recibos_personal_periodo (personal_id, anio, mes),
  CONSTRAINT fk_recibos_personal FOREIGN KEY (personal_id) REFERENCES personal(id) ON DELETE CASCADE
);
