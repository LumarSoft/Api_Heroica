-- Migración 005: Crear tabla de tareas / tablero de feedback
-- Fecha: 2026-03-29

CREATE TABLE IF NOT EXISTS tareas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  titulo        VARCHAR(255)                                                   NOT NULL,
  descripcion   TEXT,
  tipo          ENUM('bug', 'mejora', 'implementacion', 'otro')                NOT NULL DEFAULT 'otro',
  prioridad     ENUM('alta', 'media', 'baja')                                  NOT NULL DEFAULT 'media',
  estado        ENUM('pendiente', 'en_progreso', 'completado', 'cancelado')    NOT NULL DEFAULT 'pendiente',
  creado_por    INT,
  created_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at  TIMESTAMP   NULL,
  FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
);
