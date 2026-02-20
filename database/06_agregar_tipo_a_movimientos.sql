-- =====================================================
-- SCRIPT DE MIGRACIÓN: AÑADIR COLUMNA TIPO
-- Añade una columna 'tipo' (ingreso/egreso) a la tabla
-- de movimientos unificada.
-- =====================================================

ALTER TABLE `movimientos`
ADD COLUMN `tipo` enum('ingreso','egreso') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ingreso' AFTER `monto`;

-- Para asegurarnos de que los movimientos previos tengan sentido,
-- se puede setear 'egreso' a aquellos que tengan un monto negativo.

UPDATE `movimientos`
SET `tipo` = 'egreso'
WHERE `monto` < 0;

-- Opcional: convertir todos los montos a valor absoluto si se
-- prefiere usar la columna 'tipo' en vez del signo para los cálculos.
-- UPDATE `movimientos` SET `monto` = ABS(`monto`);
