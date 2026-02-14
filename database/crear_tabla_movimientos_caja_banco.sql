-- =====================================================
-- Tabla: movimientos_caja_banco
-- Descripción: Almacena los movimientos de caja banco
--              Similar a caja efectivo pero con campos
--              específicos para operaciones bancarias
-- =====================================================

CREATE TABLE IF NOT EXISTS movimientos_caja_banco (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sucursal_id INT NOT NULL,
  
  -- Información del movimiento
  fecha DATE NOT NULL,
  concepto VARCHAR(255) NOT NULL,
  descripcion TEXT,
  monto DECIMAL(15,2) NOT NULL,
  
  -- Clasificación
  tipo_movimiento ENUM('saldo_real', 'saldo_necesario') NOT NULL,
  estado ENUM('pendiente', 'aprobado', 'rechazado', 'completado') DEFAULT 'pendiente',
  prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
  
  -- Campos específicos de banco
  numero_cheque VARCHAR(50),
  banco VARCHAR(100),
  cuenta VARCHAR(50),
  cbu VARCHAR(22),
  tipo_operacion ENUM('transferencia', 'cheque', 'debito', 'credito', 'otro'),
  
  -- Relación con pago pendiente (si aplica)
  pago_pendiente_id INT,
  
  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Foreign Keys
  FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
  FOREIGN KEY (pago_pendiente_id) REFERENCES pagos_pendientes(id) ON DELETE SET NULL,
  
  -- Índices
  INDEX idx_sucursal_tipo (sucursal_id, tipo_movimiento),
  INDEX idx_fecha (fecha),
  INDEX idx_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Comentarios de la tabla
ALTER TABLE movimientos_caja_banco COMMENT = 'Movimientos de caja banco con saldo real y necesario';
