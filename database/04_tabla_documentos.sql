-- Crear tabla para múltiples documentos por sucursal
CREATE TABLE IF NOT EXISTS documentos_sucursal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sucursal_id INT NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  tipo_archivo VARCHAR(50),
  tamano_bytes INT,
  fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  usuario_subida_id INT,
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_subida_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_sucursal (sucursal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrar datos existentes de documentacion_path a la nueva tabla
INSERT INTO documentos_sucursal (sucursal_id, nombre_archivo, ruta_archivo, tipo_archivo)
SELECT 
  id,
  documentacion_nombre,
  documentacion_path,
  CASE 
    WHEN documentacion_nombre LIKE '%.pdf' THEN 'application/pdf'
    WHEN documentacion_nombre LIKE '%.jpg' OR documentacion_nombre LIKE '%.jpeg' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END
FROM sucursales
WHERE documentacion_path IS NOT NULL AND documentacion_nombre IS NOT NULL;

-- Opcional: Eliminar columnas antiguas (comentado por seguridad)
-- ALTER TABLE sucursales DROP COLUMN documentacion_path;
-- ALTER TABLE sucursales DROP COLUMN documentacion_nombre;
