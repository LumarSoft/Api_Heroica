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
 * 'log' (default): solo loguea el acceso cruzado y deja pasar. Nadie pierde acceso.
 * 'enforce': sin acceso ⇒ 403.
 *
 * El default es 'log' por decisión del responsable: hay usuarios (los dos `directivo`, ids 34 y
 * 28) que hoy operan sobre sucursales que no tienen asignadas, y pasar a 'enforce' sin
 * asignárselas antes los dejaría afuera.
 *
 * ⚠️ En modo 'log' el control NO protege nada: solo deja rastro. Es un paso intermedio para
 * medir el impacto real antes de activarlo, no un estado final. Revisar los `[sucursal-access]`
 * del log, asignar las sucursales que falten y poner SUCURSAL_ACCESS_MODE=enforce.
 */
const MODE: 'enforce' | 'log' = process.env.SUCURSAL_ACCESS_MODE === 'enforce' ? 'enforce' : 'log'

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
 * Sucursales sobre las que el usuario puede operar, para acotar listados con `IN (...)`.
 *
 * Devuelve `null` cuando NO hay que acotar nada, y un array de ids cuando sí. El array vacío es un
 * resultado legítimo: significa "ninguna", y el llamador debe devolver lista vacía, no un error.
 *
 * Devuelve `null` en dos casos:
 *   - superadmin, que bypasea todo control;
 *   - modo 'log', donde el objetivo es que **nadie pierda funcionalidad**. Acotar el listado sería
 *     bloquear en silencio, que es justo lo que 'log' no debe hacer: se registra en el log lo que
 *     se habría acotado y se devuelve todo igual que hoy.
 */
export async function sucursalesPermitidas(req: Request): Promise<number[] | null> {
  if (!req.user) return []
  if (await esSuperadmin(req.user.rol_id)) return null

  const ids = Array.from(await getSucursalesDeUsuario(req.user.id))

  if (MODE === 'log') {
    console.warn(
      `[sucursal-access] listado-sin-acotar usuario=${req.user.id} sucursales=[${ids.join(',')}] ` +
        `${req.method} ${req.originalUrl} modo=log`,
    )
    return null
  }

  return ids
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
