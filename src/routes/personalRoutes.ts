import { Router } from 'express'
import { getPersonal, getPersonalById, createPersonal, updatePersonal, deletePersonal } from '../controllers/personalController'
import { getProfesional, getNotas, createNota, deleteNota } from '../controllers/personalProfesionalController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', getPersonal)
router.get('/:id', getPersonalById)
router.post('/', createPersonal)
router.put('/:id', requirePermission('gestionar_personal'), updatePersonal)
router.delete('/:id', deletePersonal)

router.get('/:id/profesional', getProfesional)
router.get('/:id/notas', getNotas)
router.post('/:id/notas', requirePermission('gestionar_personal'), createNota)
router.delete('/:id/notas/:notaId', requirePermission('gestionar_personal'), deleteNota)

export default router
