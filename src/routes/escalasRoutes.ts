import { Router } from 'express'
import { getEscalas, createEscala, updateEscala, deleteEscala, copiarEscalas } from '../controllers/escalasController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('ver_escalas'), getEscalas)
router.post('/', requirePermission('gestionar_escalas'), createEscala)
router.post('/copiar', requirePermission('gestionar_escalas'), copiarEscalas)
router.put('/:id', requirePermission('gestionar_escalas'), updateEscala)
router.delete('/:id', requirePermission('gestionar_escalas'), deleteEscala)

export default router
