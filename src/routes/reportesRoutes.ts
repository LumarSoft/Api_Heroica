import { Router } from 'express'
import { getReportesBySucursal, getReportesAnual } from '../controllers/reportesController'
import { requireAuth, requirePermission, requireSucursalAccess } from '../middlewares/authMiddleware'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)

router.get('/:sucursalId/anual', requirePermission('ver_reportes'), requireSucursalAccess(), getReportesAnual)

router.get('/:sucursalId', requirePermission('ver_reportes'), requireSucursalAccess(), getReportesBySucursal)

export default router
