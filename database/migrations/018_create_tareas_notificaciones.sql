CREATE TABLE IF NOT EXISTS tareas_notificaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tarea_id INT NOT NULL,
  para_usuario_id INT NOT NULL,
  de_usuario_id INT NOT NULL,
  tipo ENUM('movimiento', 'comentario') NOT NULL,
  descripcion TEXT NOT NULL,
  leida TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tarea_id) REFERENCES tareas(id),
  FOREIGN KEY (para_usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (de_usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
