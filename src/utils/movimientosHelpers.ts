import { query } from '../config/database'
import { esSuperadmin, getSucursalesDeUsuario } from '../services/authCacheService'

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

// Período contable: mes al que corresponde el movimiento, con formato 'YYYY-MM' hacia el front.
// En la base, `periodo` NULL significa "el mes de la fecha": solo se guarda cuando el usuario
// elige otro mes. Así los movimientos que se generan solos no necesitan cargarlo.
const PERIODO_REGEX = /^(\d{4})-(0[1-9]|1[0-2])(-01)?$/

export function esPeriodoValido(periodo: unknown): boolean {
  return periodo === undefined || periodo === null || periodo === '' || PERIODO_REGEX.test(String(periodo))
}

/** Valor a guardar en `movimientos.periodo` ('YYYY-MM-01'), o null si coincide con el mes de la fecha. */
export function normalizarPeriodo(periodo: unknown, fecha: string): string | null {
  const match = periodo ? String(periodo).match(PERIODO_REGEX) : null
  if (!match) return null
  const mes = `${match[1]}-${match[2]}`
  return String(fecha).slice(0, 7) === mes ? null : `${mes}-01`
}

/** Período efectivo ('YYYY-MM') a partir de las columnas crudas `periodo` y `fecha`. */
export function formatearPeriodoRespuesta(periodo: any, fecha: any): string | null {
  return formatearFechaRespuesta(periodo ?? fecha)?.slice(0, 7) ?? null
}

export async function verificarAccesoSucursal(user: any, sucursalId: string | number): Promise<boolean> {
  if (await esSuperadmin(user.rol_id)) return true
  const sucursales = await getSucursalesDeUsuario(user.id)
  return sucursales.has(Number(sucursalId))
}

// Para acciones en bloque: todos los movimientos deben pertenecer a sucursales del usuario
export async function verificarAccesoMovimientos(user: any, ids: unknown[]): Promise<boolean> {
  if (await esSuperadmin(user.rol_id)) return true
  const placeholders = ids.map(() => '?').join(', ')
  const filas: any = await query(`SELECT DISTINCT sucursal_id FROM movimientos WHERE id IN (${placeholders})`, ids)
  const sucursales = await getSucursalesDeUsuario(user.id)
  return filas.every((f: any) => sucursales.has(Number(f.sucursal_id)))
}

export const MENSAJE_MOVIMIENTO_PRESTAMO =
  'Este movimiento es de un préstamo entre sucursales: se anula desde Préstamos, no desde la caja'

/** True si alguno de los movimientos lo generó un préstamo (no se editan, mueven ni borran desde la caja). */
export async function esMovimientoDePrestamo(ids: unknown[]): Promise<boolean> {
  if (ids.length === 0) return false
  const filas: any = await query(
    `SELECT 1 FROM movimientos WHERE id IN (${ids.map(() => '?').join(', ')}) AND origen = 'prestamo' LIMIT 1`,
    ids,
  )
  return filas.length > 0
}

export async function completarContraparte(contraparteId: number): Promise<void> {
  await query(`UPDATE movimientos SET estado = 'completado', saldo = 'saldo_real', es_deuda = 0 WHERE id = ?`, [
    contraparteId,
  ])
}
