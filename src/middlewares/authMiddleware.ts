import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getRolNombre, esSuperadmin, getPermisosDeRol, getModulosDeUsuario } from '../services/authCacheService'

// Extender la interfaz Request para incluir el usuario
interface AuthPayload {
  id: number
  email: string
  nombre?: string
  rol_id: number
  rol: string
}

/**
 * Middleware para verificar que el usuario está autenticado.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Token no proporcionado o inválido' })
    return
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload
    req.user = decoded
    next()
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token expirado o inválido' })
  }
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

      const rolNombre = await getRolNombre(req.user.rol_id)
      if (rolNombre === null) {
        res.status(403).json({ success: false, message: 'Rol inválido' })
        return
      }
      if (rolNombre === 'superadmin') {
        next()
        return
      }

      const permisos = await getPermisosDeRol(req.user.rol_id)
      if (permisos.has(permisoClave)) {
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
 * Middleware para verificar que el usuario tiene acceso a un MÓDULO.
 * El acceso por módulo es una capa independiente del rol: se asigna por usuario
 * en la tabla usuarios_modulos. El superadmin siempre pasa (bypass).
 * @param moduloClave Clave única del módulo (ej. "recursos_humanos", "tesoreria")
 */
export const requireModule = (moduloClave: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado' })
        return
      }

      // Bypass de superadmin (acceso a todos los módulos)
      if (await esSuperadmin(req.user.rol_id)) {
        next()
        return
      }

      // Verificar acceso al módulo en usuarios_modulos
      const modulos = await getModulosDeUsuario(req.user.id)
      if (modulos.has(moduloClave)) {
        next()
        return
      }

      res.status(403).json({
        success: false,
        message: 'No tenés acceso a este módulo',
        requiredModule: moduloClave,
      })
    } catch (error) {
      console.error('[RequireModule error]', error)
      res.status(500).json({ success: false, message: 'Error al verificar acceso al módulo' })
    }
  }
}

/**
 * Middleware para requerir AL MENOS UNO de varios permisos (OR lógico).
 * Útil para endpoints de solo-lectura compartidos por varios flujos (ej. catálogos
 * de configuración que también necesita quien crea/aprueba movimientos o pendientes,
 * sin por eso darle acceso al panel de configuración completo).
 * Siempre permite acceso si el usuario es superadmin.
 */
export const requireAnyPermission = (permisos: string[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Usuario no autenticado' })
        return
      }

      if (await esSuperadmin(req.user.rol_id)) {
        next()
        return
      }

      const permisosDelRol = await getPermisosDeRol(req.user.rol_id)
      if (permisos.some(p => permisosDelRol.has(p))) {
        next()
        return
      }

      res.status(403).json({
        success: false,
        message: 'No tienes permiso para realizar esta acción',
        requiredPermission: permisos.join(' | '),
      })
    } catch (error) {
      console.error('[RequireAnyPermission error]', error)
      res.status(500).json({ success: false, message: 'Error al verificar permisos' })
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

      if (await esSuperadmin(req.user.rol_id)) {
        next()
        return
      }

      const permisosDelRol = await getPermisosDeRol(req.user.rol_id)
      const hasAll = permisos.every(p => permisosDelRol.has(p))

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
