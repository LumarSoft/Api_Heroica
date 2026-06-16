CREATE TABLE IF NOT EXISTS personal_notas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  personal_id INT NOT NULL,
  contenido TEXT NOT NULL,
  usuario_id INT NOT NULL,
  usuario_nombre VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
  INDEX idx_personal_notas_personal_id (personal_id),
  INDEX idx_personal_notas_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
