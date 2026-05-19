import { Router } from 'express'
import { getMotivosBajaPorSucursal, postMotivoBaja } from '../controllers/rrhhMotivosBajaController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('ver_solicitudes'), getMotivosBajaPorSucursal)
router.post('/', requirePermission('crear_solicitudes'), postMotivoBaja)

export default router
