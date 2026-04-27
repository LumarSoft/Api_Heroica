import { Router } from 'express'
import {
  createEventoCalendario,
  deleteEventoCalendario,
  getEventosCalendario,
  updateEventoCalendario,
} from '../controllers/rrhhCalendarioController'
import { requireAuth } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', getEventosCalendario)
router.post('/', createEventoCalendario)
router.put('/:id', updateEventoCalendario)
router.delete('/:id', deleteEventoCalendario)

export default router
