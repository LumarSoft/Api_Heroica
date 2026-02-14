-- =====================================================
-- Tabla: pagos_pendientes
-- Descripción: Almacena las órdenes de pago que deben
--              ser revisadas por el administrador
-- =====================================================

CREATE TABLE IF NOT EXISTS pagos_pendientes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sucursal_id INT NOT NULL,
  usuario_creador_id INT NOT NULL,
  
  -- Información del pago
  fecha_solicitud DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_pago_programada DATE NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  descripcion TEXT,
  monto DECIMAL(15,2) NOT NULL,
  proveedor VARCHAR(255),
  
  -- Clasificación
  tipo_caja ENUM('efectivo', 'banco') NOT NULL,
  prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
  estado ENUM('pendiente', 'aprobado', 'rechazado') DEFAULT 'pendiente',
  
  -- Información de revisión
  motivo_rechazo TEXT,
  usuario_revisor_id INT,
  fecha_revision DATETIME,
  
  -- Relación con movimiento creado (cuando se aprueba)
  movimiento_id INT,
  
  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Foreign Keys
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_creador_id) REFERENCES usuarios(id),
  FOREIGN KEY (usuario_revisor_id) REFERENCES usuarios(id),
  
  -- Índices para mejorar rendimiento
  INDEX idx_sucursal_estado (sucursal_id, estado),
  INDEX idx_fecha_solicitud (fecha_solicitud),
  INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comentarios de la tabla
ALTER TABLE pagos_pendientes COMMENT = 'Órdenes de pago pendientes de autorización';
