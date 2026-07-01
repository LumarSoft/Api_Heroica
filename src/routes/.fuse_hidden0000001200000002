import { Router } from 'express'
import { getAreas, createArea, updateArea, deleteArea } from '../controllers/areasController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('ver_areas'), getAreas)
router.post('/', requirePermission('gestionar_areas'), createArea)
router.put('/:id', requirePermission('gestionar_areas'), updateArea)
router.delete('/:id', requirePermission('gestionar_areas'), deleteArea)

export default router
