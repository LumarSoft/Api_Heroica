import { Router } from 'express'
import { getReportesBySucursal, getReportesAnual } from '../controllers/reportesController'
import {
  deletePlantillaCorteBalance,
  getCorteBalance,
  putPlantillaCorteBalance,
} from '../controllers/reportesCorteBalanceController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)
router.use(requireModule('tesoreria'))

// Corte de balance mensual: la plantilla es global (va antes de /:sucursalId)
router.put('/corte-balance/plantilla', requirePermission('editar_plantilla_reportes'), putPlantillaCorteBalance)
router.delete('/corte-balance/plantilla', requirePermission('editar_plantilla_reportes'), deletePlantillaCorteBalance)

router.get('/:sucursalId/corte-balance', requirePermission('ver_reportes'), getCorteBalance)

router.get('/:sucursalId/anual', requirePermission('ver_reportes'), getReportesAnual)

router.get('/:sucursalId', requirePermission('ver_reportes'), getReportesBySucursal)

export default router
