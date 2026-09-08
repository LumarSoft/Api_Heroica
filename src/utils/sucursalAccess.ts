import type { Request, Response } from 'express'
import { esSuperadmin, getSucursalesDeUsuario } from '../services/authCacheService'
import { verificarAccesoSucursal } from './movimientosHelpers'

/**
 * Se lanza cuando el usuario autenticado no tiene acceso a la sucursal del recurso.
 * Los controladores la capturan y responden con responderSinAcceso(res).
 */
export class SucursalAccessError extends Error {
  constructor() {
    super('NO_ACCESS')
    this.name = 'SucursalAccessError'
  }
}

/**
 * 'enforce' (default): sin acceso ⇒ 403.
 * 'log': solo loguea y deja pasar. Sirve para desplegar unos días observando el log antes de
 * hacer cumplir el control. NO es un modo permanente.
 */
const MODE: 'enforce' | 'log' = process.env.SUCURSAL_ACCESS_MODE === 'log' ? 'log' : 'enforce'

/**
 * Verifica que el usuario de la request tenga acceso a la sucursal indicada.
 *
 * Si sucursalId es null/undefined/no numérico no valida nada: es responsabilidad del llamador
 * decidir qué hacer con un filtro ausente (típicamente, filtrar por las sucursales del usuario).
 *
 * Los superadmin pasan siempre (lo resuelve verificarAccesoSucursal).
 */
export async function assertSucursalAccess(
  req: Request,
  sucursalId: number | string | null | undefined,
): Promise<void> {
  if (sucursalId === null || sucursalId === undefined || sucursalId === '') return
  if (Number.isNaN(Number(sucursalId))) return

  if (!req.user) throw new SucursalAccessError()

  const ok = await verificarAccesoSucursal(req.user, sucursalId)
  if (ok) return

  console.warn(
    `[sucursal-access] usuario=${req.user.id} sucursal=${sucursalId} ${req.method} ${req.originalUrl} modo=${MODE}`,
  )

  if (MODE === 'enforce') throw new SucursalAccessError()
}

/**
 * Sucursales sobre las que el usuario puede operar.
 *
 * Devuelve `null` cuando no hay restricción que aplicar (superadmin), un array de ids en el resto
 * de los casos. El array vacío es un resultado legítimo: significa "ninguna", y el llamador debe
 * devolver lista vacía, no un error.
 */
export async function sucursalesPermitidas(req: Request): Promise<number[] | null> {
  if (!req.user) return []
  if (await esSuperadmin(req.user.rol_id)) return null
  return Array.from(await getSucursalesDeUsuario(req.user.id))
}

export function responderSinAcceso(res: Response): void {
  res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
}

/**
 * Azúcar para el patrón repetido en los catch de los controladores:
 * si el error es de acceso responde 403 y devuelve true; si no, devuelve false.
 */
export function manejarErrorDeAcceso(err: unknown, res: Response): boolean {
  if (err instanceof SucursalAccessError) {
    responderSinAcceso(res)
    return true
  }
  return false
}
