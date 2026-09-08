import { Router } from 'express'
import {
  getCuentasBancarias,
  createCuentaBancaria,
  updateCuentaBancaria,
  deleteCuentaBancaria,
} from '../controllers/cuentasBancariasController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'
import { requireSucursalAccess, requireSucursalAccessDeRecurso } from '../middlewares/sucursalAccessMiddleware'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)
router.use(requireModule('tesoreria'))

// :id identifica una cuenta bancaria: su sucursal se resuelve por lookup.
router.param('id', requireSucursalAccessDeRecurso('cuentaBancaria', 'id'))

// Rutas base: /api/cuentas-bancarias
// Las cuentas bancarias forman parte de la gestión de sucursales
router.get(
  '/:sucursalId',
  requirePermission('ver_sucursales'),
  requireSucursalAccess('params', 'sucursalId'),
  getCuentasBancarias,
)
router.post(
  '/:sucursalId',
  requirePermission('gestionar_sucursales'),
  requireSucursalAccess('params', 'sucursalId'),
  createCuentaBancaria,
)
router.put('/:id', requirePermission('gestionar_sucursales'), updateCuentaBancaria)
router.delete('/:id', requirePermission('gestionar_sucursales'), deleteCuentaBancaria)

export default router
