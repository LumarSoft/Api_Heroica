import { Router } from 'express'
import {
  getPagosPendientesBySucursal,
  getPagosPendientesCount,
  getAllPagosPendientes,
  createPagoPendiente,
  aprobarPagoPendiente,
  rechazarPagoPendiente,
  deletePagoPendiente,
  getHistorialByUser,
  aprobarPagosPendientesBulk,
  rechazarPagosPendientesBulk,
} from '../controllers/movimientosController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'
import { requireSucursalAccess, requireSucursalAccessDeRecurso } from '../middlewares/sucursalAccessMiddleware'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)
router.use(requireModule('tesoreria'))

// Los pagos pendientes son filas de movimientos con estado = 'pendiente': :id es un movimiento.
router.param('id', requireSucursalAccessDeRecurso('movimiento', 'id'))

// Historial de un usuario
router.get('/historial/:userId', requirePermission('ver_pendientes'), getHistorialByUser)

// Todos los pagos pendientes (vista global; el controlador acota a las sucursales del usuario)
router.get('/all', requirePermission('ver_pendientes'), getAllPagosPendientes)

router.get(
  '/:sucursalId/count',
  requirePermission('ver_pendientes'),
  requireSucursalAccess('params', 'sucursalId'),
  getPagosPendientesCount,
)

// Pagos pendientes de una sucursal
router.get(
  '/:sucursalId',
  requirePermission('ver_pendientes'),
  requireSucursalAccess('params', 'sucursalId'),
  getPagosPendientesBySucursal,
)

// Crear nuevo pago pendiente
router.post(
  '/',
  requirePermission('cargar_pendientes'),
  requireSucursalAccess('body', 'sucursal_id'),
  createPagoPendiente,
)

router.put('/bulk/aprobar', requirePermission('aprobar_pendientes'), aprobarPagosPendientesBulk)
router.put('/bulk/rechazar', requirePermission('aprobar_pendientes'), rechazarPagosPendientesBulk)

// Aprobar pago pendiente
router.put('/:id/aprobar', requirePermission('aprobar_pendientes'), aprobarPagoPendiente)

// Rechazar pago pendiente
router.put('/:id/rechazar', requirePermission('aprobar_pendientes'), rechazarPagoPendiente)

// Eliminar pago pendiente
router.delete('/:id', requirePermission('aprobar_pendientes'), deletePagoPendiente)

export default router
