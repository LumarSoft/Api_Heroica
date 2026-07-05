import { query } from '../config/database'

/**
 * Identidad del usuario que ejecuta el asistente. Es exactamente el payload
 * del JWT (`req.user`), de modo que HeroicAI actúa SIEMPRE como el usuario
 * logueado — nunca con privilegios elevados.
 */
export interface HeroicaiUser {
  id: number
  email: string
  nombre?: string
  rol_id: number
  rol: string
}

/**
 * Sucursal a la que el usuario tiene acceso (para scoping de las tools).
 */
export interface SucursalAccesible {
  id: number
  nombre: string
}

async function esSuperAdmin(user: HeroicaiUser): Promise<boolean> {
  const rows = (await query(`SELECT nombre FROM roles WHERE id = ?`, [user.rol_id])) as Array<{ nombre: string }>
  return rows.length > 0 && rows[0].nombre === 'superadmin'
}

/**
 * Verifica que el usuario tenga un permiso por clave. Superadmin siempre pasa.
 * Lanza un Error con mensaje claro si no lo tiene (lo captura el ejecutor de tools).
 */
export async function assertPermiso(user: HeroicaiUser, clave: string): Promise<void> {
  if (await esSuperAdmin(user)) return

  const rows = (await query(
    `SELECT 1
     FROM permisos p
     INNER JOIN roles_permisos rp ON p.id = rp.permiso_id
     WHERE rp.rol_id = ? AND p.clave = ?
     LIMIT 1`,
    [user.rol_id, clave],
  )) as unknown[]

  if (rows.length === 0) {
    throw new PermisoDenegadoError(clave)
  }
}

/**
 * Devuelve las sucursales a las que el usuario tiene acceso.
 * Superadmin ve todas las sucursales activas.
 */
export async function getSucursalesDelUsuario(user: HeroicaiUser): Promise<SucursalAccesible[]> {
  if (await esSuperAdmin(user)) {
    return (await query(
      `SELECT id, nombre FROM sucursales WHERE deleted_at IS NULL ORDER BY nombre ASC`,
    )) as SucursalAccesible[]
  }

  return (await query(
    `SELECT s.id, s.nombre
     FROM sucursales s
     INNER JOIN usuarios_sucursales us ON s.id = us.sucursal_id
     WHERE us.usuario_id = ? AND s.deleted_at IS NULL
     ORDER BY s.nombre ASC`,
    [user.id],
  )) as SucursalAccesible[]
}

/**
 * Resuelve el conjunto de IDs de sucursal permitidos y, si se pidió una sucursal
 * puntual, valida que el usuario tenga acceso. Lanza si no.
 */
export async function resolverSucursalesPermitidas(user: HeroicaiUser, sucursalIdPedida?: number): Promise<number[]> {
  const accesibles = await getSucursalesDelUsuario(user)
  const idsPermitidos = accesibles.map(s => s.id)

  if (sucursalIdPedida !== undefined && sucursalIdPedida !== null) {
    if (!idsPermitidos.includes(sucursalIdPedida)) {
      throw new SucursalDenegadaError(sucursalIdPedida)
    }
    return [sucursalIdPedida]
  }

  return idsPermitidos
}

export class PermisoDenegadoError extends Error {
  constructor(public clave: string) {
    super(`El usuario no tiene el permiso "${clave}" para esta consulta.`)
    this.name = 'PermisoDenegadoError'
  }
}

export class SucursalDenegadaError extends Error {
  constructor(public sucursalId: number) {
    super(`El usuario no tiene acceso a la sucursal ${sucursalId}.`)
    this.name = 'SucursalDenegadaError'
  }
}
