import { Router } from 'express'
import {
  enviarLiquidacionAPagos,
  enviarSueldosAPagos,
  getSueldosPeriodo,
  updateLiquidacionFinalAjustes,
  updateSueldoPeriodo,
  updateSueldoPeriodoMeta,
} from '../controllers/rrhhSueldosController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'
import { requireSucursalAccess, requireSucursalAccessQueryOrBody } from '../middlewares/sucursalAccessMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('recursos_humanos'))

// Lectura
router.get('/', requirePermission('ver_sueldos'), requireSucursalAccess('query', 'sucursal_id'), getSueldosPeriodo)

// Escritura: requiere gestionar_sueldos, no alcanza con el permiso de lectura.
// El acceso a la sucursal se controla con middleware donde el id viaja en la request, y con
// lookup dentro del controlador en las rutas por :liquidacionId.
router.post(
  '/enviar-pagos',
  requirePermission('gestionar_sueldos'),
  requireSucursalAccess('body', 'sucursal_id'),
  enviarSueldosAPagos,
)
router.post(
  '/liquidaciones/:liquidacionId/enviar-pagos',
  requirePermission('gestionar_sueldos'),
  enviarLiquidacionAPagos,
)
router.put('/liquidaciones/:liquidacionId', requirePermission('gestionar_sueldos'), updateLiquidacionFinalAjustes)
router.put(
  '/:personalId/periodo/meta',
  requirePermission('gestionar_sueldos'),
  requireSucursalAccessQueryOrBody('sucursal_id'),
  updateSueldoPeriodoMeta,
)
router.put(
  '/:personalId/periodo',
  requirePermission('gestionar_sueldos'),
  requireSucursalAccessQueryOrBody('sucursal_id'),
  updateSueldoPeriodo,
)

export default router
