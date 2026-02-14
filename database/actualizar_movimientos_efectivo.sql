-- =====================================================
-- Actualización: movimientos_caja_efectivo
-- Descripción: Agrega relación con pagos pendientes
-- =====================================================

-- Verificar si la columna ya existe antes de agregarla
-- Si da error, significa que ya existe y puedes ignorarlo

-- Agregar columna para relacionar con pagos pendientes
ALTER TABLE movimientos_caja_efectivo 
ADD COLUMN pago_pendiente_id INT;

-- Agregar foreign key
ALTER TABLE movimientos_caja_efectivo
ADD CONSTRAINT fk_movimiento_pago_pendiente 
FOREIGN KEY (pago_pendiente_id) REFERENCES pagos_pendientes(id) ON DELETE SET NULL;

-- Agregar índice
ALTER TABLE movimientos_caja_efectivo
ADD INDEX idx_pago_pendiente (pago_pendiente_id);
