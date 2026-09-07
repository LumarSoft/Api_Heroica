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

const router = Router()

router.use(requireAuth)
router.use(requireModule('recursos_humanos'))

// Lectura
router.get('/', requirePermission('ver_sueldos'), getSueldosPeriodo)

// Escritura: requiere gestionar_sueldos, no alcanza con el permiso de lectura
router.post('/enviar-pagos', requirePermission('gestionar_sueldos'), enviarSueldosAPagos)
router.post(
  '/liquidaciones/:liquidacionId/enviar-pagos',
  requirePermission('gestionar_sueldos'),
  enviarLiquidacionAPagos,
)
router.put('/liquidaciones/:liquidacionId', requirePermission('gestionar_sueldos'), updateLiquidacionFinalAjustes)
router.put('/:personalId/periodo/meta', requirePermission('gestionar_sueldos'), updateSueldoPeriodoMeta)
router.put('/:personalId/periodo', requirePermission('gestionar_sueldos'), updateSueldoPeriodo)

export default router
