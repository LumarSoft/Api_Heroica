import { Router } from 'express'
import { createNotificaciones, getMisNotificaciones, marcarLeidas } from '../controllers/notificacionesController'
import { requireAuth } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/mis', getMisNotificaciones)
router.post('/', createNotificaciones)
router.patch('/leer', marcarLeidas)

export default router
