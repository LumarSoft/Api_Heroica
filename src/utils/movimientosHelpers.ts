import { query } from '../config/database'

export function normalizarFecha(fecha: string): string {
  if (!fecha) return fecha
  const soloFecha = fecha.split('T')[0]
  return `${soloFecha} 12:00:00`
}

export function formatearFechaRespuesta(fecha: any): string | null {
  if (!fecha) return null
  if (fecha instanceof Date) {
    const year = fecha.getFullYear()
    const month = String(fecha.getMonth() + 1).padStart(2, '0')
    const day = String(fecha.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const fechaStr = String(fecha)
  if (fechaStr.includes('T')) return fechaStr.split('T')[0]
  if (/^\d{4}-\d{2}-\d{2}/.test(fechaStr)) return fechaStr.substring(0, 10)
  return null
}

export async function verificarAccesoSucursal(user: any, sucursalId: string | number): Promise<boolean> {
  const rolResult: any = await query(`SELECT nombre FROM roles WHERE id = ?`, [user.rol_id])
  if (rolResult.length > 0 && rolResult[0].nombre === 'superadmin') return true
  const acceso: any = await query(`SELECT 1 FROM usuarios_sucursales WHERE usuario_id = ? AND sucursal_id = ?`, [
    user.id,
    sucursalId,
  ])
  return Array.isArray(acceso) && acceso.length > 0
}

/**
 * Paginación opt-in: si la request trae ?limit= (y opcionalmente ?offset=),
 * devuelve una cláusula LIMIT segura (enteros validados). Si no, devuelve ''
 * y el endpoint se comporta exactamente como antes (sin romper el frontend actual).
 */
export function buildLimitClause(queryParams: Record<string, unknown>): string {
  const limit = Number(queryParams.limit)
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) return ''
  const offset = Number(queryParams.offset)
  const safeOffset = Number.isInteger(offset) && offset > 0 ? offset : 0
  return ` LIMIT ${limit} OFFSET ${safeOffset}`
}

/**
 * Valida que un array recibido por body sea de IDs enteros positivos.
 * Devuelve el array normalizado o null si es inválido.
 */
export function normalizarIds(ids: unknown): number[] | null {
  if (!Array.isArray(ids) || ids.length === 0) return null
  const normalizados = ids.map(id => Number(id))
  if (normalizados.some(id => !Number.isInteger(id) || id <= 0)) return null
  return normalizados
}

/**
 * Verifica que el usuario tenga acceso a TODAS las sucursales de los movimientos indicados.
 * Superadmin siempre tiene acceso. Devuelve false si algún movimiento no existe o
 * pertenece a una sucursal a la que el usuario no está asignado.
 */
export async function verificarAccesoMovimientos(user: any, ids: number[]): Promise<boolean> {
  const rolResult: any = await query(`SELECT nombre FROM roles WHERE id = ?`, [user.rol_id])
  if (rolResult.length > 0 && rolResult[0].nombre === 'superadmin') return true

  const placeholders = ids.map(() => '?').join(', ')
  const rows: any = await query(
    `SELECT COUNT(*) AS total
     FROM movimientos m
     INNER JOIN usuarios_sucursales us ON us.sucursal_id = m.sucursal_id AND us.usuario_id = ?
     WHERE m.id IN (${placeholders})`,
    [user.id, ...ids],
  )
  return Array.isArray(rows) && Number(rows[0]?.total) === ids.length
}

export async function completarContraparte(contraparteId: number): Promise<void> {
  await query(`UPDATE movimientos SET estado = 'completado', saldo = 'saldo_real', es_deuda = 0 WHERE id = ?`, [
    contraparteId,
  ])
}
