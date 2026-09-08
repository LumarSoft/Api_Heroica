import { Router } from 'express'
import {
  createIncentivo,
  deactivateIncentivo,
  getIncentivos,
  updateIncentivo,
} from '../controllers/rrhhIncentivosController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'
import { requireSucursalAccess, requireSucursalAccessDeRecurso } from '../middlewares/sucursalAccessMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('recursos_humanos'))

// :id identifica un incentivo: su sucursal se resuelve por lookup.
router.param('id', requireSucursalAccessDeRecurso('incentivo', 'id'))

router.get('/', requirePermission('ver_incentivos'), requireSucursalAccess('query', 'sucursal_id'), getIncentivos)
router.post(
  '/',
  requirePermission('gestionar_incentivos'),
  requireSucursalAccess('body', 'sucursal_id'),
  createIncentivo,
)
router.put('/:id', requirePermission('gestionar_incentivos'), updateIncentivo)
router.delete('/:id', requirePermission('gestionar_incentivos'), deactivateIncentivo)

export default router
