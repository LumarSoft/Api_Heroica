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

// Escritura. Sigue gateada por ver_sueldos, que es un permiso de lectura: separar la escritura en
// gestionar_sueldos se revirtió por decisión del responsable, para no tocar el esquema de permisos
// que hoy funciona. Queda anotado como deuda.
// El acceso a la sucursal sí se controla: con middleware donde el id viaja en la request, y con
// lookup dentro del controlador en las rutas por :liquidacionId.
router.post(
  '/enviar-pagos',
  requirePermission('ver_sueldos'),
  requireSucursalAccess('body', 'sucursal_id'),
  enviarSueldosAPagos,
)
router.post('/liquidaciones/:liquidacionId/enviar-pagos', requirePermission('ver_sueldos'), enviarLiquidacionAPagos)
router.put('/liquidaciones/:liquidacionId', requirePermission('ver_sueldos'), updateLiquidacionFinalAjustes)
router.put(
  '/:personalId/periodo/meta',
  requirePermission('ver_sueldos'),
  requireSucursalAccessQueryOrBody('sucursal_id'),
  updateSueldoPeriodoMeta,
)
router.put(
  '/:personalId/periodo',
  requirePermission('ver_sueldos'),
  requireSucursalAccessQueryOrBody('sucursal_id'),
  updateSueldoPeriodo,
)

export default router
