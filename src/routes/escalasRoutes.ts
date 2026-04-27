import { Router } from 'express'
import { getEscalas, createEscala, updateEscala, deleteEscala } from '../controllers/escalasController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', getEscalas)
router.post('/', requirePermission('gestionar_roles'), createEscala)
router.put('/:id', requirePermission('gestionar_roles'), updateEscala)
router.delete('/:id', requirePermission('gestionar_roles'), deleteEscala)

export default router
