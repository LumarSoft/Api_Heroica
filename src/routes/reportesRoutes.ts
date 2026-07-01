import { Router } from 'express'
import { getReportesBySucursal, getReportesAnual } from '../controllers/reportesController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)
router.use(requireModule('tesoreria'))

router.get('/:sucursalId/anual', requirePermission('ver_reportes'), getReportesAnual)

router.get('/:sucursalId', requirePermission('ver_reportes'), getReportesBySucursal)

export default router
