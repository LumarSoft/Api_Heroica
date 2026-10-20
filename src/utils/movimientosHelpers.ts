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

export async function completarContraparte(contraparteId: number): Promise<void> {
  await query(`UPDATE movimientos SET estado = 'completado', saldo = 'saldo_real', es_deuda = 0 WHERE id = ?`, [
    contraparteId,
  ])
}
