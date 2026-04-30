import { Router } from 'express'
import { getPersonal, getPersonalById, createPersonal, updatePersonal, deletePersonal } from '../controllers/personalController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', getPersonal)
router.get('/:id', getPersonalById)
router.post('/', createPersonal)
router.put('/:id', requirePermission('gestionar_personal'), updatePersonal)
router.delete('/:id', deletePersonal)

export default router
