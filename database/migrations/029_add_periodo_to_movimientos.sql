-- Migración 029: Período contable en movimientos
-- Fecha: 2026-10-20
-- Descripción: mes al que corresponde cada movimiento, independiente de cuándo se carga o se paga
--              (ej. el SUSS de septiembre pagado en octubre). En pantalla se muestra como MM/AA.
--
--   `periodo` guarda el primer día del mes elegido (ej. 2026-09-01) SOLO cuando difiere del
--   mes de `fecha`. NULL significa "el mes de la fecha". Por eso no hace falta backfill: todos
--   los movimientos existentes quedan imputados al mes de su fecha, y los que se generan solos
--   (importación bancaria, transferencias, RRHH, mover) no necesitan cargarlo.
--
--   Período efectivo en SQL: DATE_FORMAT(COALESCE(periodo, fecha), '%Y-%m')
--
--   Numerada 029 porque la rama dev ya usa 026-028.

ALTER TABLE `movimientos`
  ADD COLUMN `periodo` DATE DEFAULT NULL COMMENT 'Primer día del mes imputado; NULL = mes de fecha' AFTER `fecha`;
