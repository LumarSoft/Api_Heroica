import type { PoolConnection } from 'mysql2/promise'
import type { SolicitudRow } from './rrhhSolicitudesService'

export interface AdelantoPagoColumnas {
  adelanto_circuito_id: number | null
  adelanto_movimiento_id: number | null
  adelanto_estado: 'pendiente' | 'aprobado' | 'rechazado' | 'completado' | null
  adelanto_saldo: 'saldo_real' | 'saldo_necesario' | null
  adelanto_fecha: string | null
  adelanto_monto: number | string | null
  adelanto_deleted_at: Date | string | null
}

export const ADELANTO_PAGOS_JOIN_SQL = `
  LEFT JOIN rrhh_adelantos_pagos adelanto_pago ON adelanto_pago.solicitud_id = s.id
  LEFT JOIN movimientos adelanto_movimiento ON adelanto_movimiento.id = adelanto_pago.movimiento_id
`

export const ADELANTO_PAGO_COLUMNS_SQL = `
  adelanto_pago.solicitud_id AS adelanto_circuito_id,
  adelanto_pago.movimiento_id AS adelanto_movimiento_id,
  adelanto_movimiento.estado AS adelanto_estado,
  adelanto_movimiento.saldo AS adelanto_saldo,
  DATE_FORMAT(adelanto_movimiento.fecha, '%Y-%m-%d') AS adelanto_fecha,
  adelanto_movimiento.monto AS adelanto_monto,
  adelanto_movimiento.deleted_at AS adelanto_deleted_at
`

/** Conserva registros anteriores; los adelantos del nuevo circuito sólo cuentan cuando se pagaron. */
export const ADELANTO_INCORPORADO_SQL = `(
  s.tipo <> 'Adelantos'
  OR adelanto_pago.solicitud_id IS NULL
  OR (adelanto_movimiento.estado = 'completado' AND adelanto_movimiento.deleted_at IS NULL)
)`

/** Para los nuevos adelantos, el período de descuento corresponde a la fecha del pago. */
export const ADELANTO_FECHA_SQL = `CASE
  WHEN s.tipo = 'Adelantos' AND adelanto_pago.solicitud_id IS NOT NULL THEN adelanto_movimiento.fecha
  ELSE s.fecha_solicitud END`

export async function registrarCircuitoAdelanto(connection: PoolConnection, solicitudId: number): Promise<void> {
  await connection.execute(
    `INSERT INTO rrhh_adelantos_pagos (solicitud_id) VALUES (?)
     ON DUPLICATE KEY UPDATE solicitud_id = VALUES(solicitud_id)`,
    [solicitudId],
  )
}

/** El llamador mantiene bloqueada la solicitud y confirma movimiento y vínculo en una sola transacción. */
export async function crearPagoAdelanto(
  connection: PoolConnection,
  solicitud: Pick<SolicitudRow, 'id' | 'personal_id' | 'sucursal_id' | 'usuario_id' | 'personal_nombre' | 'legajo'>,
  detalles: Record<string, unknown>,
): Promise<number> {
  if (!solicitud.personal_id) throw new Error('El adelanto requiere un colaborador asociado')
  const monto = Number(detalles.monto)
  const fecha = typeof detalles.fecha === 'string' ? detalles.fecha : ''
  const motivo = typeof detalles.motivo === 'string' ? detalles.motivo.trim() : ''
  if (!Number.isFinite(monto) || monto <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !motivo)
    throw new Error('El adelanto no tiene monto, fecha y motivo válidos')

  await registrarCircuitoAdelanto(connection, solicitud.id)
  const [rows] = await connection.execute(
    'SELECT movimiento_id FROM rrhh_adelantos_pagos WHERE solicitud_id = ? FOR UPDATE',
    [solicitud.id],
  )
  const existente = (rows as Array<{ movimiento_id: number | null }>)[0]?.movimiento_id
  if (existente) return Number(existente)

  const concepto = `Adelanto de sueldo · ${solicitud.personal_nombre ?? `Colaborador #${solicitud.personal_id}`}`.slice(
    0,
    255,
  )
  const comentarios = `Generado desde RRHH · Adelanto #${solicitud.id}${solicitud.legajo ? ` · Legajo ${solicitud.legajo}` : ''}\n${motivo}`
  const [result] = await connection.execute(
    `INSERT INTO movimientos
     (sucursal_id, user_id, fecha, concepto, comentarios, monto, tipo_movimiento, saldo, prioridad, estado, tipo, moneda)
     VALUES (?, ?, ?, ?, ?, ?, 'efectivo', 'saldo_necesario', 'media', 'pendiente', 'egreso', 'ARS')`,
    [solicitud.sucursal_id, solicitud.usuario_id, fecha, concepto, comentarios, -Math.abs(monto)],
  )
  const movimientoId = Number((result as { insertId: number }).insertId)
  await connection.execute('UPDATE rrhh_adelantos_pagos SET movimiento_id = ? WHERE solicitud_id = ?', [
    movimientoId,
    solicitud.id,
  ])
  return movimientoId
}

export function separarPagoAdelanto<T extends Partial<AdelantoPagoColumnas>>(row: T) {
  const {
    adelanto_circuito_id,
    adelanto_movimiento_id,
    adelanto_estado,
    adelanto_saldo,
    adelanto_fecha,
    adelanto_monto,
    adelanto_deleted_at,
    ...solicitud
  } = row
  return {
    solicitud,
    pago_tesoreria: adelanto_circuito_id
      ? {
          movimiento_id: adelanto_movimiento_id ?? null,
          estado: adelanto_estado ?? null,
          saldo: adelanto_saldo ?? null,
          fecha: adelanto_fecha ?? null,
          monto: adelanto_monto == null ? null : Math.abs(Number(adelanto_monto)),
          eliminado: Boolean(adelanto_deleted_at),
        }
      : null,
  }
}

/** El legajo y los sueldos reflejan el importe y la fecha efectivamente registrados por Tesorería. */
export function detallesAdelantoPagado(detalles: Record<string, unknown>, row: Partial<AdelantoPagoColumnas>) {
  if (!row.adelanto_circuito_id || row.adelanto_estado !== 'completado' || row.adelanto_deleted_at) return detalles
  return {
    ...detalles,
    monto: Math.abs(Number(row.adelanto_monto)),
    fecha: row.adelanto_fecha,
  }
}
