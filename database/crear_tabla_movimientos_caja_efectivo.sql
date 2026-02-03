-- =====================================================
-- Script SQL para crear tabla de movimientos de caja
-- Base de datos: heroica
-- =====================================================

USE heroica;

-- Crear tabla de movimientos de caja en efectivo
CREATE TABLE IF NOT EXISTS movimientos_caja_efectivo (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sucursal_id INT NOT NULL,
    user_id INT NOT NULL,
    fecha DATE NOT NULL,
    concepto VARCHAR(255) NOT NULL,
    monto DECIMAL(15, 2) NOT NULL,
    descripcion TEXT,
    prioridad ENUM('baja', 'media', 'alta') DEFAULT 'media',
    tipo_movimiento ENUM('saldo_real', 'saldo_necesario') NOT NULL,
    estado ENUM('pendiente', 'aprobado', 'rechazado', 'completado') DEFAULT 'pendiente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Relaciones
    FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
    
    -- Índices
    INDEX idx_sucursal_id (sucursal_id),
    INDEX idx_user_id (user_id),
    INDEX idx_fecha (fecha),
    INDEX idx_tipo_movimiento (tipo_movimiento),
    INDEX idx_estado (estado),
    INDEX idx_prioridad (prioridad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insertar datos de ejemplo para la sucursal 1 (asumiendo que existe un usuario con id=1)
INSERT INTO movimientos_caja_efectivo (sucursal_id, user_id, fecha, concepto, monto, descripcion, prioridad, tipo_movimiento, estado) 
VALUES 
    -- Saldo Real
    (1, 1, '2026-02-01', 'Venta de contado', 15000.00, 'Venta de productos del día', 'media', 'saldo_real', 'completado'),
    (1, 1, '2026-02-02', 'Pago a proveedor', -8000.00, 'Pago a proveedor de bebidas', 'alta', 'saldo_real', 'completado'),
    (1, 1, '2026-02-03', 'Cobro de cliente', 12000.00, 'Cobro de factura pendiente', 'media', 'saldo_real', 'completado'),
    
    -- Saldo Necesario
    (1, 1, '2026-02-04', 'Pago de servicios', 5000.00, 'Pago de luz y agua', 'alta', 'saldo_necesario', 'pendiente'),
    (1, 1, '2026-02-05', 'Compra de insumos', 7500.00, 'Compra de insumos de cocina', 'media', 'saldo_necesario', 'pendiente'),
    (1, 1, '2026-02-06', 'Pago de salarios', 25000.00, 'Pago de salarios del personal', 'alta', 'saldo_necesario', 'pendiente')
ON DUPLICATE KEY UPDATE concepto = concepto;

-- =====================================================
-- Fin del script
-- =====================================================
