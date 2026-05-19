import { Router } from 'express'
import {
  createEventoCalendario,
  createEventosCalendarioBatch,
  deleteEventoCalendario,
  getEventosCalendario,
  updateEventoCalendario,
} from '../controllers/rrhhCalendarioController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('ver_calendario'), getEventosCalendario)
router.post('/', requirePermission('gestionar_calendario'), createEventoCalendario)
router.post('/batch', requirePermission('gestionar_calendario'), createEventosCalendarioBatch)
router.put('/:id', requirePermission('gestionar_calendario'), updateEventoCalendario)
router.delete('/:id', requirePermission('gestionar_calendario'), deleteEventoCalendario)

export default router
