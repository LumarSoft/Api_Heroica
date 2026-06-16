import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import speakeasy from 'speakeasy'
import QRCode from 'qrcode'
import { query } from '../config/database'

const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 días

interface User {
  id: number
  email: string
  password: string
  nombre: string
  rol_id: number
  rol_nombre: string
  must_change_password: boolean
  two_factor_enabled: boolean
  two_factor_secret: string | null
}

/** Genera el JWT de sesión completo y devuelve también los permisos del rol. */
async function buildSessionToken(user: User): Promise<{ token: string; permisos: string[] }> {
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      rol_id: user.rol_id,
      rol: user.rol_nombre,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: '24h' },
  )

  const permisosResult: any = await query(
    `SELECT p.clave 
     FROM permisos p
     INNER JOIN roles_permisos rp ON p.id = rp.permiso_id
     WHERE rp.rol_id = ?`,
    [user.rol_id],
  )
  const permisos: string[] = permisosResult.map((p: any) => p.clave)

  return { token, permisos }
}

/** Fija la cookie HttpOnly del token de dispositivo. */
function setDeviceCookie(res: Response, rawToken: string): void {
  res.cookie('device_token', rawToken, {
    httpOnly: true,
    secure: true, // siempre Secure — la cookie solo viaja por HTTPS
    sameSite: 'none', // requerido para cross-site (frontend y API en dominios distintos)
    maxAge: DEVICE_TOKEN_TTL_MS,
    path: '/',
  })
}

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y contraseña son requeridos',
      })
    }

    const result: any = await query(
      `SELECT u.*, r.nombre as rol_nombre 
       FROM usuarios u 
       LEFT JOIN roles r ON u.rol_id = r.id 
       WHERE u.email = ? AND u.activo = TRUE AND u.deleted_at IS NULL`,
      [email],
    )

    if (!Array.isArray(result) || result.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas',
      })
    }

    const user: User = result[0]

    const passwordValida = await bcrypt.compare(password, user.password)

    if (!passwordValida) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas',
      })
    }

    if (!user.two_factor_enabled) {
      return res.json({
        success: true,
        needsSetup2FA: true,
        userId: user.id,
        userData: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          rol: user.rol_nombre,
          rol_id: user.rol_id,
        },
        message: 'Debes configurar autenticación de doble factor',
      })
    }

    // Verificar token de dispositivo de confianza
    const deviceCookie: string | undefined = req.cookies?.device_token
    if (deviceCookie) {
      try {
        const tokenHash = crypto.createHash('sha256').update(deviceCookie).digest('hex')

        const deviceResult: any = await query(
          `SELECT id FROM dispositivos_confianza
           WHERE token_hash = ? AND usuario_id = ? AND revocado = 0 AND expires_at > NOW()`,
          [tokenHash, user.id],
        )

        if (Array.isArray(deviceResult) && deviceResult.length > 0) {
          await query(`UPDATE dispositivos_confianza SET last_used_at = NOW() WHERE id = ?`, [deviceResult[0].id])

          const { token, permisos } = await buildSessionToken(user)

          return res.json({
            success: true,
            message: 'Inicio de sesión exitoso (dispositivo de confianza)',
            data: {
              token,
              user: {
                id: user.id,
                email: user.email,
                nombre: user.nombre,
                rol: user.rol_nombre,
                rol_id: user.rol_id,
                must_change_password: Boolean(user.must_change_password),
                permisos,
              },
            },
          })
        }
      } catch (deviceErr) {
        // Token de dispositivo inválido o error; se continúa con el flujo normal de 2FA
        console.warn('[login] Error al validar token de dispositivo:', deviceErr)
      }
    }

    const tempToken = jwt.sign({ id: user.id, email: user.email, temp2fa: true }, process.env.JWT_SECRET as string, {
      expiresIn: '5m',
    })

    return res.json({
      success: true,
      requires2FA: true,
      tempToken,
      message: 'Se requiere código de verificación',
    })
  } catch (error) {
    console.error('Error en login:', error)
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
    })
  }
}

export const verifyToken = async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token no proporcionado',
      })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string)

    res.json({
      success: true,
      data: decoded,
    })
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Token inválido o expirado',
    })
  }
}

export const verify2FA = async (req: Request, res: Response) => {
  try {
    const { tempToken, code, rememberDevice } = req.body

    if (!tempToken || !code) {
      return res.status(400).json({
        success: false,
        message: 'Token temporal y código son requeridos',
      })
    }

    const decoded: any = jwt.verify(tempToken, process.env.JWT_SECRET as string)

    if (!decoded.temp2fa) {
      return res.status(401).json({
        success: false,
        message: 'Token inválido',
      })
    }

    const result: any = await query(
      `SELECT u.*, r.nombre as rol_nombre 
       FROM usuarios u 
       LEFT JOIN roles r ON u.rol_id = r.id 
       WHERE u.id = ? AND u.activo = TRUE`,
      [decoded.id],
    )

    if (!Array.isArray(result) || result.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no encontrado',
      })
    }

    const user: User = result[0]

    if (!user.two_factor_enabled || !user.two_factor_secret) {
      return res.status(400).json({
        success: false,
        message: '2FA no está habilitado para este usuario',
      })
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 2,
    })

    if (!verified) {
      console.warn(`[verify2FA] Código inválido para usuario ${user.id} desde IP ${req.ip}`)
      return res.status(401).json({
        success: false,
        message: 'Código de verificación inválido',
      })
    }

    const { token, permisos } = await buildSessionToken(user)

    // Emitir token de dispositivo si el usuario lo solicitó
    if (rememberDevice === true) {
      const rawToken = crypto.randomBytes(32).toString('hex') // 256 bits criptográficamente seguros
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
      const userAgent = (req.headers['user-agent'] ?? 'Unknown').slice(0, 512)
      const ipAddress = (req.ip ?? req.socket?.remoteAddress ?? 'Unknown').slice(0, 45)
      const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_MS)

      await query(
        `INSERT INTO dispositivos_confianza (usuario_id, token_hash, user_agent, ip_address, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [user.id, tokenHash, userAgent, ipAddress, expiresAt],
      )

      setDeviceCookie(res, rawToken)
    }

    res.json({
      success: true,
      message: 'Verificación exitosa',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          nombre: user.nombre,
          rol: user.rol_nombre,
          rol_id: user.rol_id,
          must_change_password: Boolean(user.must_change_password),
          permisos,
        },
      },
    })
  } catch (error) {
    console.error('Error en verify2FA:', error)
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
    })
  }
}

export const enable2FA = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId es requerido',
      })
    }

    const secret = speakeasy.generateSecret({
      name: `Heroica (${userId})`,
      length: 32,
    })

    await query(`UPDATE usuarios SET two_factor_secret = ? WHERE id = ?`, [secret.base32, userId])

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url as string)

    res.json({
      success: true,
      data: {
        secret: secret.base32,
        qrCode: qrCodeUrl,
      },
    })
  } catch (error) {
    console.error('Error en enable2FA:', error)
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
    })
  }
}

export const confirm2FA = async (req: Request, res: Response) => {
  try {
    const { userId, code } = req.body

    if (!userId || !code) {
      return res.status(400).json({
        success: false,
        message: 'userId y código son requeridos',
      })
    }

    const result: any = await query(
      `SELECT u.*, r.nombre as rol_nombre 
       FROM usuarios u 
       LEFT JOIN roles r ON u.rol_id = r.id 
       WHERE u.id = ?`,
      [userId],
    )

    if (!Array.isArray(result) || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado',
      })
    }

    const user = result[0]

    if (!user.two_factor_secret) {
      return res.status(400).json({
        success: false,
        message: '2FA no está configurado',
      })
    }

    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 2,
    })

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: 'Código de verificación inválido',
      })
    }

    await query(`UPDATE usuarios SET two_factor_enabled = 1 WHERE id = ?`, [userId])

    const tempToken = jwt.sign({ id: user.id, email: user.email, temp2fa: true }, process.env.JWT_SECRET as string, {
      expiresIn: '5m',
    })

    res.json({
      success: true,
      message: '2FA habilitado exitosamente',
      tempToken,
    })
  } catch (error) {
    console.error('Error en confirm2FA:', error)
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
    })
  }
}

export const disable2FA = async (req: Request, res: Response) => {
  try {
    const { userId, password } = req.body

    if (!userId || !password) {
      return res.status(400).json({
        success: false,
        message: 'userId y contraseña son requeridos',
      })
    }

    const result: any = await query(`SELECT password FROM usuarios WHERE id = ?`, [userId])

    if (!Array.isArray(result) || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado',
      })
    }

    const user = result[0]
    const passwordValida = await bcrypt.compare(password, user.password)

    if (!passwordValida) {
      return res.status(401).json({
        success: false,
        message: 'Contraseña incorrecta',
      })
    }

    await query(`UPDATE usuarios SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?`, [userId])

    res.json({
      success: true,
      message: '2FA deshabilitado exitosamente',
    })
  } catch (error) {
    console.error('Error en disable2FA:', error)
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
    })
  }
}

export const reset2FA = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId es requerido',
      })
    }

    await query(`UPDATE usuarios SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?`, [userId])

    res.json({
      success: true,
      message: '2FA reseteado. El usuario deberá configurarlo en su próximo login',
    })
  } catch (error) {
    console.error('Error en reset2FA:', error)
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
    })
  }
}

// PUT /api/auth/change-password
export const changePassword = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Token no proporcionado',
      })
    }

    const token = authHeader.split(' ')[1]
    let decoded: any
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET as string)
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Token inválido o expirado',
      })
    }

    const userId = decoded.id
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña actual y la nueva son requeridas',
      })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe tener al menos 6 caracteres',
      })
    }

    const result: any = await query('SELECT password FROM usuarios WHERE id = ? AND activo = TRUE', [userId])

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado',
      })
    }

    const passwordValida = await bcrypt.compare(currentPassword, result[0].password)
    if (!passwordValida) {
      return res.status(400).json({
        success: false,
        message: 'La contraseña actual es incorrecta',
      })
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe ser diferente a la actual',
      })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)

    await query('UPDATE usuarios SET password = ?, must_change_password = 0 WHERE id = ?', [hashedPassword, userId])

    res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente',
    })
  } catch (error) {
    console.error('Error al cambiar contraseña:', error)
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
    })
  }
}

// GET /api/auth/dispositivos  (requireAuth)
export const listDispositivos = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id

    const result: any = await query(
      `SELECT id, user_agent, ip_address, created_at, last_used_at, expires_at
       FROM dispositivos_confianza
       WHERE usuario_id = ? AND revocado = 0 AND expires_at > NOW()
       ORDER BY COALESCE(last_used_at, created_at) DESC`,
      [userId],
    )

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al listar dispositivos:', error)
    res.status(500).json({ success: false, message: 'Error interno del servidor' })
  }
}

// DELETE /api/auth/dispositivos/:id  (requireAuth)
export const revocarDispositivo = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const dispositivoId = Number(req.params.id)

    if (!dispositivoId || isNaN(dispositivoId)) {
      return res.status(400).json({ success: false, message: 'ID de dispositivo inválido' })
    }

    const result: any = await query(`UPDATE dispositivos_confianza SET revocado = 1 WHERE id = ? AND usuario_id = ?`, [
      dispositivoId,
      userId,
    ])

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Dispositivo no encontrado' })
    }

    res.json({ success: true, message: 'Dispositivo revocado exitosamente' })
  } catch (error) {
    console.error('Error al revocar dispositivo:', error)
    res.status(500).json({ success: false, message: 'Error interno del servidor' })
  }
}

// DELETE /api/auth/dispositivos  (requireAuth) — revoca TODOS y borra la cookie del cliente
export const revocarTodosDispositivos = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id

    await query(`UPDATE dispositivos_confianza SET revocado = 1 WHERE usuario_id = ?`, [userId])

    res.clearCookie('device_token', { path: '/', httpOnly: true, secure: true, sameSite: 'none' })

    res.json({ success: true, message: 'Todos los dispositivos de confianza han sido revocados' })
  } catch (error) {
    console.error('Error al revocar todos los dispositivos:', error)
    res.status(500).json({ success: false, message: 'Error interno del servidor' })
  }
}
