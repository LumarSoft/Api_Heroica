import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { chatHeroicai, getConversaciones, getConversacion, deleteConversacion } from '../controllers/heroicaiController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

// Todas las rutas requieren sesión y el permiso de HeroicAI.
router.use(requireAuth, requirePermission('usar_heroicai'))

// Límite de uso del asistente: máximo 30 mensajes por usuario cada 5 minutos.
const heroicaiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => String(req.user?.id ?? req.ip),
  message: {
    success: false,
    message: 'Alcanzaste el límite de consultas a HeroicAI. Esperá unos minutos.',
  },
})

router.post('/chat', heroicaiLimiter, chatHeroicai)
router.get('/conversaciones', getConversaciones)
router.get('/conversaciones/:id', getConversacion)
router.delete('/conversaciones/:id', deleteConversacion)

export default router
