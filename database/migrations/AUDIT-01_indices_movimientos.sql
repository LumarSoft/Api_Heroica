-- AUDIT-01: Índice compuesto para los listados principales de movimientos
-- (filtran por sucursal_id + tipo_movimiento + moneda + deleted_at y ordenan por id DESC).
-- Acelera getMovimientosBySucursal / getMovimientosBancoBySucursal a medida que crece la tabla.
-- Ejecutar en una ventana de bajo tráfico.

CREATE INDEX idx_mov_listado ON movimientos (sucursal_id, tipo_movimiento, moneda, deleted_at, id);

-- Verificación sugerida:
-- EXPLAIN SELECT m.id FROM movimientos m
--   WHERE m.sucursal_id = 1 AND m.tipo_movimiento = 'efectivo' AND m.moneda = 'ARS' AND m.deleted_at IS NULL
--   ORDER BY m.id DESC LIMIT 50;
