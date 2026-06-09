import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  login,
  verifyToken,
  changePassword,
  verify2FA,
  enable2FA,
  confirm2FA,
  disable2FA,
  reset2FA,
  listDispositivos,
  revocarDispositivo,
  revocarTodosDispositivos,
} from '../controllers/authController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

// Rate limit para flujos sensibles de 2FA (setup/confirmación): 15 intentos por IP cada 15 min
const twoFASetupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Demasiados intentos. Intente nuevamente en 15 minutos.',
  },
})

router.post('/login', login)
router.post('/verify', verifyToken)
router.post('/verify-2fa', verify2FA)

// Setup de 2FA: autorizado por setupToken firmado emitido en el login (sin sesión todavía)
router.post('/enable-2fa', twoFASetupLimiter, enable2FA)
router.post('/confirm-2fa', twoFASetupLimiter, confirm2FA)

// Deshabilitar el PROPIO 2FA: requiere sesión activa + contraseña
router.post('/disable-2fa', requireAuth, twoFASetupLimiter, disable2FA)

// Resetear 2FA de otro usuario: acción administrativa
router.post('/reset-2fa', requireAuth, requirePermission('gestionar_usuarios'), reset2FA)

router.put('/change-password', requireAuth, changePassword)

// Gestión de dispositivos de confianza (requieren sesión activa)
router.get('/dispositivos', requireAuth, listDispositivos)
router.delete('/dispositivos', requireAuth, revocarTodosDispositivos)
router.delete('/dispositivos/:id', requireAuth, revocarDispositivo)

export default router
