-- ============================================================
--  DIAGNÓSTICO: ¿dónde cayeron los movimientos importados?
-- ============================================================
--  La caja separa Saldo Real de Saldo Necesario por la columna `estado`:
--     estado = 'completado'              → Saldo Real
--     estado IN ('aprobado','pendiente') → Saldo Necesario
--
--  La importación inserta siempre estado='completado' y saldo='saldo_real'.
--  Si aparece algo en necesario, esta consulta muestra exactamente qué.
-- ============================================================

-- 1. Resumen: cómo quedó repartido lo importado
SELECT
  m.importacion_id,
  m.estado,
  m.saldo,
  CASE
    WHEN m.estado = 'completado' THEN 'Saldo Real'
    WHEN m.estado IN ('aprobado', 'pendiente') THEN 'Saldo Necesario'
    ELSE CONCAT('?? estado inesperado: ', m.estado)
  END                        AS donde_aparece,
  COUNT(*)                   AS movimientos,
  SUM(m.monto)               AS total
FROM movimientos m
WHERE m.origen = 'importacion'
  AND m.deleted_at IS NULL
GROUP BY m.importacion_id, m.estado, m.saldo
ORDER BY m.importacion_id, m.estado;

-- 2. El detalle de los que NO quedaron en Saldo Real.
--    Si esto devuelve filas, hay un problema en la importación.
SELECT m.id, m.fecha, m.concepto, m.monto, m.tipo, m.estado, m.saldo, m.es_deuda, m.importacion_id
FROM movimientos m
WHERE m.origen = 'importacion'
  AND m.deleted_at IS NULL
  AND m.estado <> 'completado'
ORDER BY m.fecha, m.id;

-- 3. Lo que hay en Saldo Necesario pero NO vino de una importación.
--    Si el punto 2 da vacío y acá hay filas, entonces lo que ves en necesario
--    ya estaba cargado a mano y no lo generó el importador.
SELECT
  COALESCE(m.origen, 'manual')  AS origen,
  COUNT(*)                      AS movimientos,
  SUM(m.monto)                  AS total,
  MIN(m.fecha)                  AS desde,
  MAX(m.fecha)                  AS hasta
FROM movimientos m
WHERE m.tipo_movimiento = 'banco'
  AND m.deleted_at IS NULL
  AND m.estado IN ('aprobado', 'pendiente')
GROUP BY COALESCE(m.origen, 'manual');

-- 4. Control: ¿la columna `saldo` guardó lo que se le mandó?
--    Si `saldo` es un ENUM y MySQL corre en modo no estricto, un valor inválido
--    se guarda como cadena vacía en lugar de fallar. Esto lo detecta.
SELECT m.saldo, COUNT(*) AS movimientos
FROM movimientos m
WHERE m.origen = 'importacion' AND m.deleted_at IS NULL
GROUP BY m.saldo;
