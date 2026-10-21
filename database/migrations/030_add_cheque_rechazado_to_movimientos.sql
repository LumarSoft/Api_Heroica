-- Migración 030: Cheques / eCheqs rechazados
-- Fecha: 2026-10-20
-- Descripción: marca manual de rechazo para movimientos de banco pagados con cheque o eCheq.
--
--   Es solo una etiqueta: el movimiento no cambia de estado ni de saldo (un eCheq emitido
--   que rebotó sigue siendo un pago pendiente). El estado del cheque se deriva así:
--     pendiente  = medio cheque/eCheq sin número
--     cargado    = con número
--     rechazado  = cheque_rechazado = 1 (tiene prioridad sobre los otros dos)
--
--   Numerada 030: la 029 es el período contable (rama TE-periodo-movimientos) y dev usa 026-028.

ALTER TABLE `movimientos`
  ADD COLUMN `cheque_rechazado` TINYINT(1) NOT NULL DEFAULT 0 AFTER `numero_cheque`,
  ADD COLUMN `cheque_rechazado_at` DATETIME DEFAULT NULL AFTER `cheque_rechazado`,
  ADD COLUMN `cheque_rechazo_motivo` VARCHAR(255) DEFAULT NULL AFTER `cheque_rechazado_at`;

-- ------------------------------------------------------------
-- Opcional (revisar antes con el cliente): en producción hay eCheqs que se marcaron con
-- estado 'rechazado' para indicar el rebote, y por eso desaparecieron de la caja.
-- Para verlos:
--
--   SELECT m.id, m.sucursal_id, m.fecha, m.concepto, m.monto, m.numero_cheque
--   FROM movimientos m JOIN medios_pago mp ON mp.id = m.medio_pago_id
--   WHERE m.deleted_at IS NULL AND m.estado = 'rechazado' AND mp.nombre REGEXP 'cheque|echeq';
--
-- Para pasarlos a la marca nueva y devolverlos a Saldo Necesario (solo con OK del cliente):
--
--   UPDATE movimientos SET estado = 'aprobado', saldo = 'saldo_necesario',
--          cheque_rechazado = 1, cheque_rechazado_at = NOW(),
--          cheque_rechazo_motivo = 'Migrado: estaba marcado como rechazado'
--   WHERE id IN (...);
-- ------------------------------------------------------------
