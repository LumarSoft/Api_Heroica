import { Router } from 'express'
import {
  enviarLiquidacionAPagos,
  enviarSueldosAPagos,
  getSueldosPeriodo,
  updateLiquidacionFinalAjustes,
  updateSueldoPeriodo,
  updateSueldoPeriodoMeta,
} from '../controllers/rrhhSueldosController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('ver_sueldos'), getSueldosPeriodo)
router.post('/enviar-pagos', requirePermission('ver_sueldos'), enviarSueldosAPagos)
router.post('/liquidaciones/:liquidacionId/enviar-pagos', requirePermission('ver_sueldos'), enviarLiquidacionAPagos)
router.put('/liquidaciones/:liquidacionId', requirePermission('ver_sueldos'), updateLiquidacionFinalAjustes)
router.put('/:personalId/periodo/meta', requirePermission('ver_sueldos'), updateSueldoPeriodoMeta)
router.put('/:personalId/periodo', requirePermission('ver_sueldos'), updateSueldoPeriodo)

export default router
