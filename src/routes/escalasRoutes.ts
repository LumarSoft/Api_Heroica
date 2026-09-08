import { Router } from 'express'
import { getEscalas, createEscala, updateEscala, deleteEscala, copiarEscalas } from '../controllers/escalasController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'
import { requireSucursalAccess, requireSucursalAccessDeRecurso } from '../middlewares/sucursalAccessMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('recursos_humanos'))

// :id identifica una escala salarial: su sucursal se resuelve por lookup.
router.param('id', requireSucursalAccessDeRecurso('escala', 'id'))

router.get('/', requirePermission('ver_escalas'), requireSucursalAccess('query', 'sucursal_id'), getEscalas)
router.post('/', requirePermission('gestionar_escalas'), requireSucursalAccess('body', 'sucursal_id'), createEscala)
router.post('/copiar', requirePermission('gestionar_escalas'), copiarEscalas)
router.put('/:id', requirePermission('gestionar_escalas'), updateEscala)
router.delete('/:id', requirePermission('gestionar_escalas'), deleteEscala)

export default router
