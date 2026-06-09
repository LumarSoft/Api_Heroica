import { Router } from 'express'
import {
  getPagosPendientesBySucursal,
  getAllPagosPendientes,
  createPagoPendiente,
  aprobarPagoPendiente,
  rechazarPagoPendiente,
  deletePagoPendiente,
  getHistorialByUser,
} from '../controllers/movimientosController'
import { requireAuth, requirePermission, requireSucursalAccess } from '../middlewares/authMiddleware'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)

// Historial de un usuario
router.get('/historial/:userId', requirePermission('ver_pendientes'), getHistorialByUser)

// Todos los pagos pendientes (vista global)
router.get('/all', requirePermission('ver_pendientes'), getAllPagosPendientes)

// Pagos pendientes de una sucursal
router.get('/:sucursalId', requirePermission('ver_pendientes'), requireSucursalAccess(), getPagosPendientesBySucursal)

// Crear nuevo pago pendiente
router.post('/', requirePermission('cargar_pendientes'), createPagoPendiente)

// Aprobar pago pendiente
router.put('/:id/aprobar', requirePermission('aprobar_pendientes'), aprobarPagoPendiente)

// Rechazar pago pendiente
router.put('/:id/rechazar', requirePermission('aprobar_pendientes'), rechazarPagoPendiente)

// Eliminar pago pendiente
router.delete('/:id', requirePermission('aprobar_pendientes'), deletePagoPendiente)

export default router
