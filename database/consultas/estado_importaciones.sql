-- ============================================================
--  ESTADO DE LAS IMPORTACIONES BANCARIAS
-- ============================================================
--  Sirve para ver qué quedó cargado después de un intento fallido y decidir si
--  hay que revertir algo antes de volver a importar.
--
--  Las importaciones corren dentro de una transacción, así que un error deja
--  todo revertido. Pero si una llegó a hacer COMMIT y otra falló después, acá
--  se ve con claridad.
-- ============================================================

-- 1. Importaciones registradas, con lo que efectivamente quedó en la caja
SELECT
  i.id,
  i.created_at,
  i.estado,
  b.nombre                                   AS banco,
  i.nombre_archivo,
  i.fecha_desde,
  i.fecha_hasta,
  i.movimientos_creados                      AS movs_declarados,
  COUNT(DISTINCT m.id)                       AS movs_vivos_en_caja,
  COUNT(f.id)                                AS filas_respaldo,
  i.monto_neto
FROM importaciones_bancarias i
LEFT JOIN bancos b ON i.banco_id = b.id
LEFT JOIN movimientos m ON m.importacion_id = i.id AND m.deleted_at IS NULL
LEFT JOIN importaciones_bancarias_filas f ON f.importacion_id = i.id
GROUP BY i.id
ORDER BY i.created_at DESC;

-- 2. Movimientos importados que quedaron huérfanos (sin cabecera viva).
--    Debería devolver 0 filas. Si devuelve algo, esos movimientos hay que
--    borrarlos a mano: son restos de una corrida que no cerró bien.
SELECT m.id, m.fecha, m.concepto, m.monto, m.importacion_id
FROM movimientos m
LEFT JOIN importaciones_bancarias i ON m.importacion_id = i.id
WHERE m.origen = 'importacion'
  AND m.deleted_at IS NULL
  AND (i.id IS NULL OR i.estado = 'revertida');

-- 3. Para revertir una importación completa, usar el endpoint
--    POST /api/importacion-bancaria/:id/revertir en lugar de tocar la base:
--    hace el soft delete de los movimientos Y libera las filas de respaldo,
--    que es lo que permite volver a importar el mismo extracto.
