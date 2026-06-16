import { Router } from 'express'
import { getPuestos, createPuesto, updatePuesto, deletePuesto } from '../controllers/puestosController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('recursos_humanos'))

router.get('/', requirePermission('ver_puestos'), getPuestos)
router.post('/', requirePermission('gestionar_puestos'), createPuesto)
router.put('/:id', requirePermission('gestionar_puestos'), updatePuesto)
router.delete('/:id', requirePermission('gestionar_puestos'), deletePuesto)

export default router
