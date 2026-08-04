import { query } from '../config/database'

const TTL_MS = 60_000

interface Entrada<T> {
  valor: T
  expiraEn: number
}

class CacheTTL<K, V> {
  private mapa = new Map<K, Entrada<V>>()

  get(clave: K): V | undefined {
    const entrada = this.mapa.get(clave)
    if (!entrada) return undefined
    if (Date.now() > entrada.expiraEn) {
      this.mapa.delete(clave)
      return undefined
    }
    return entrada.valor
  }

  set(clave: K, valor: V): void {
    this.mapa.set(clave, { valor, expiraEn: Date.now() + TTL_MS })
  }

  delete(clave: K): void {
    this.mapa.delete(clave)
  }

  clear(): void {
    this.mapa.clear()
  }
}

const cacheRolNombre = new CacheTTL<number, string | null>()
const cacheRolPermisos = new CacheTTL<number, Set<string>>()
const cacheUsuarioModulos = new CacheTTL<number, Set<string>>()
const cacheUsuarioSucursales = new CacheTTL<number, Set<number>>()
const cacheUsuarioRol = new CacheTTL<number, string | null>()

export const getRolNombre = async (rolId: number): Promise<string | null> => {
  const cacheado = cacheRolNombre.get(rolId)
  if (cacheado !== undefined) return cacheado

  const filas: any = await query('SELECT nombre FROM roles WHERE id = ?', [rolId])
  const nombre = filas.length > 0 ? (filas[0].nombre as string) : null

  cacheRolNombre.set(rolId, nombre)
  return nombre
}

export const getRolDeUsuario = async (usuarioId: number): Promise<string | null> => {
  const cacheado = cacheUsuarioRol.get(usuarioId)
  if (cacheado !== undefined) return cacheado

  const filas: any = await query(
    'SELECT r.nombre FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id WHERE u.id = ?',
    [usuarioId],
  )
  const nombre = filas.length > 0 ? ((filas[0].nombre as string) ?? null) : null

  cacheUsuarioRol.set(usuarioId, nombre)
  return nombre
}

export const esSuperadmin = async (rolId: number): Promise<boolean> => {
  return (await getRolNombre(rolId)) === 'superadmin'
}

export const getPermisosDeRol = async (rolId: number): Promise<Set<string>> => {
  const cacheado = cacheRolPermisos.get(rolId)
  if (cacheado !== undefined) return cacheado

  const filas: any = await query(
    `SELECT p.clave
     FROM permisos p
     INNER JOIN roles_permisos rp ON p.id = rp.permiso_id
     WHERE rp.rol_id = ?`,
    [rolId],
  )
  const permisos = new Set<string>(filas.map((f: any) => f.clave as string))

  cacheRolPermisos.set(rolId, permisos)
  return permisos
}

export const getModulosDeUsuario = async (usuarioId: number): Promise<Set<string>> => {
  const cacheado = cacheUsuarioModulos.get(usuarioId)
  if (cacheado !== undefined) return cacheado

  const filas: any = await query(
    `SELECT m.clave
     FROM usuarios_modulos um
     INNER JOIN modulos m ON m.id = um.modulo_id
     WHERE um.usuario_id = ?`,
    [usuarioId],
  )
  const modulos = new Set<string>(filas.map((f: any) => f.clave as string))

  cacheUsuarioModulos.set(usuarioId, modulos)
  return modulos
}

export const getSucursalesDeUsuario = async (usuarioId: number): Promise<Set<number>> => {
  const cacheado = cacheUsuarioSucursales.get(usuarioId)
  if (cacheado !== undefined) return cacheado

  const filas: any = await query('SELECT sucursal_id FROM usuarios_sucursales WHERE usuario_id = ?', [usuarioId])
  const sucursales = new Set<number>(filas.map((f: any) => Number(f.sucursal_id)))

  cacheUsuarioSucursales.set(usuarioId, sucursales)
  return sucursales
}

export const invalidarRol = (rolId: number): void => {
  cacheRolNombre.delete(rolId)
  cacheRolPermisos.delete(rolId)
}

export const invalidarUsuario = (usuarioId: number): void => {
  cacheUsuarioModulos.delete(usuarioId)
  cacheUsuarioSucursales.delete(usuarioId)
  cacheUsuarioRol.delete(usuarioId)
}

export const invalidarTodo = (): void => {
  cacheRolNombre.clear()
  cacheRolPermisos.clear()
  cacheUsuarioModulos.clear()
  cacheUsuarioSucursales.clear()
  cacheUsuarioRol.clear()
}
