import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { query } from '../config/database'

// Extender la interfaz Request para incluir el usuario
interface AuthPayload {
  id: number
  email: string
  rol_id: number
  rol: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

// Cache en memoria del estado "activo" de los usuarios (TTL 60s).
// Permite revocar sesiones al desactivar un usuario sin pagar una query por request.
const ACTIVO_CACHE_TTL_MS = 60 * 1000
const activoCache = new Map<number, { activo: boolean; expiresAt: number }>()

async function isUsuarioActivo(userId: number): Promise<boolean> {
  const cached = activoCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.activo

  const result: any = await query(`SELECT 1 FROM usuarios WHERE id = ? AND activo = TRUE AND deleted_at IS NULL`, [
    userId,
  ])
  const activo = Array.isArray(result) && result.length > 0
  activoCache.set(userId, { activo, expiresAt: Date.now() + ACTIVO_CACHE_TTL_MS })
  return activo
}

/** Invalida el cache de un usuario (llamar al desactivarlo/eliminarlo para corte inmediato). */
export const invalidateUsuarioActivoCache = (userId: number): void => {
  activoCache.delete(userId)
}

/**
 * Middleware para verificar que el usuario está autenticado y sigue activo.
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Token no proporcionado o inválido' })
    return
  }

  const token = authHeader.split(' ')[1]

  let decoded: AuthPayload
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token expirado o inválido' })
    return
  }

  // Los tokens temporales (2FA/setup) nunca valen como sesión completa
  if ((decoded as any).temp2fa || (decoded as any).setup2fa) {
    res.status(401).json({ success: false, message: 'Token no válido para esta operación' })
    return
  }

  try {
    // Revocación: si el usuario fue desactivado/eliminado, su token deja de servir
    if (!(await isUsuarioActivo(decoded.id))) {
      res.status(401).json({ success: false, message: 'Usuario inactivo o eliminado' })
      return
    }
  } catch (error) {
    console.error('[requireAuth] Error al verificar usuario activo:', error)
    res.status(500).json({ success: false, message: 'Error de autenticación' })
    return
  }

  req.user = decoded
  next()
}

/**
 * Middleware para verificar si el usuario tiene un permiso específico.
 * Siempre permite acceso si el usuario es superadmin.
 * @param permisoClave Clave única del permiso (ej. "ver_movimientos")
 */
export const requirePermission = (permisoClave: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado' })
        return
      }

      // 1. Obtener el rol del usuario (haciendo un bypass para superadmin por seguridad extra en backend)
      const rolResult: any = await query(
        `SELECT r.nombre 
         FROM roles r 
         WHERE r.id = ?`,
        [req.user.rol_id],
      )

      if (rolResult.length === 0) {
        res.status(403).json({ success: false, message: 'Rol inválido' })
        return
      }

      const isSuperAdmin = rolResult[0].nombre === 'superadmin'
      if (isSuperAdmin) {
        next()
        return
      }

      // 2. Verificar el permiso en base de datos
      const hasPermissionResult: any = await query(
        `SELECT 1 
         FROM permisos p
         INNER JOIN roles_permisos rp ON p.id = rp.permiso_id
         WHERE rp.rol_id = ? AND p.clave = ?`,
        [req.user.rol_id, permisoClave],
      )

      if (hasPermissionResult.length > 0) {
        // Tiene el permiso
        next()
        return
      }

      // No tiene el permiso
      res.status(403).json({
        success: false,
        message: 'No tienes permiso para realizar esta acción',
        requiredPermission: permisoClave,
      })
    } catch (error) {
      console.error('[RequirePermission error]', error)
      res.status(500).json({ success: false, message: 'Error al verificar permisos' })
    }
  }
}

/**
 * Middleware de scoping por sucursal: verifica que el usuario esté asignado a la
 * sucursal indicada en el parámetro de ruta (usuarios_sucursales). Superadmin pasa siempre.
 * Evita IDOR horizontal: un usuario de la sucursal A no puede operar la sucursal B.
 * @param paramName Nombre del parámetro de ruta que contiene el id de sucursal
 */
export const requireSucursalAccess = (paramName = 'sucursalId') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado' })
        return
      }

      const sucursalId = Number(req.params[paramName])
      if (!Number.isInteger(sucursalId) || sucursalId <= 0) {
        res.status(400).json({ success: false, message: 'ID de sucursal inválido' })
        return
      }

      const rolResult: any = await query(`SELECT nombre FROM roles WHERE id = ?`, [req.user.rol_id])
      if (rolResult.length > 0 && rolResult[0].nombre === 'superadmin') {
        next()
        return
      }

      const acceso: any = await query(
        `SELECT 1 FROM usuarios_sucursales WHERE usuario_id = ? AND sucursal_id = ?`,
        [req.user.id, sucursalId],
      )

      if (Array.isArray(acceso) && acceso.length > 0) {
        next()
        return
      }

      res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    } catch (error) {
      console.error('[RequireSucursalAccess error]', error)
      res.status(500).json({ success: false, message: 'Error al verificar acceso a sucursal' })
    }
  }
}

/**
 * Middleware auxiliar para requerir múltiples permisos (OR lógico o AND lógico).
 * Implementado por defecto como "Debe tener TODOS los permisos en la lista" (AND).
 */
export const requireAllPermissions = (permisos: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado' })
        return
      }

      const rolResult: any = await query(`SELECT nombre FROM roles WHERE id = ?`, [req.user.rol_id])
      if (rolResult.length > 0 && rolResult[0].nombre === 'superadmin') {
        next()
        return
      }

      const queryParams = [req.user.rol_id, ...permisos]
      const placeholders = permisos.map(() => '?').join(',')

      const permissionsResult: any = await query(
        `SELECT p.clave
         FROM permisos p
         INNER JOIN roles_permisos rp ON p.id = rp.permiso_id
         WHERE rp.rol_id = ? AND p.clave IN (${placeholders})`,
        queryParams,
      )

      const rolesDbPermisos = permissionsResult.map((p: any) => p.clave)
      const hasAll = permisos.every(p => rolesDbPermisos.includes(p))

      if (hasAll) {
        next()
      } else {
        res.status(403).json({
          success: false,
          message: 'No tienes todos los permisos requeridos',
        })
      }
    } catch (error) {
      console.error('[RequireAllPermissions error]', error)
      res.status(500).json({ success: false, message: 'Error al verificar permisos' })
    }
  }
}
