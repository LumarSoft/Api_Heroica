import { Router } from 'express'
import { createNotificaciones, getMisNotificaciones, marcarLeidas } from '../controllers/notificacionesController'
import { getDestinatariosSugeridos, enviarNotificacionEmail } from '../controllers/notificacionesEmailController'
import { requireAuth } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/mis', getMisNotificaciones)
router.post('/', createNotificaciones)
router.patch('/leer', marcarLeidas)

router.get('/email/destinatarios', getDestinatariosSugeridos)
router.post('/email/enviar', enviarNotificacionEmail)

export default router
