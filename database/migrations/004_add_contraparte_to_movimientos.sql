-- Migración 004: Agregar campo movimiento_contraparte_id en movimientos
-- Este campo vincula una deuda de sucursal origen con su deuda espejo en sucursal destino.
-- Cuando se paga/completa una deuda (es_deuda = 0), la contraparte también se completa automáticamente.

ALTER TABLE `movimientos`
  ADD COLUMN `movimiento_contraparte_id` int DEFAULT NULL
    COMMENT 'ID del movimiento deuda espejo en la sucursal contraparte (vinculado al crear créditos entre sucursales)',
  ADD KEY `idx_contraparte_id` (`movimiento_contraparte_id`),
  ADD CONSTRAINT `movimientos_ibfk_contraparte`
    FOREIGN KEY (`movimiento_contraparte_id`) REFERENCES `movimientos` (`id`)
    ON DELETE SET NULL;
