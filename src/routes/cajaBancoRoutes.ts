import { Router } from 'express'
import {
  getMovimientosBancoBySucursal,
  createMovimientoBanco,
  updateMovimientoBanco,
  deleteMovimientoBanco,
  moverARealBanco as moverAReal,
  getTotalesBanco,
  updateEstadoMovimientoBanco,
  toggleDeudaBanco,
  deleteBulkMovimientos,
  moverBulkMovimientos,
  transferenciaInternaBanco,
  updateComentarioBanco,
  updateOrdenMovimiento,
} from '../controllers/movimientosController'
import { exportBancoToExcel } from '../controllers/exportController'
import {
  getDocumentos,
  uploadDocumento,
  deleteDocumento,
  downloadDocumento,
  upload,
} from '../controllers/documentosMovimientoController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'
import { requireSucursalAccess, requireSucursalAccessDeRecurso } from '../middlewares/sucursalAccessMiddleware'

const router = Router()

// :id y :movimientoId identifican un movimiento de banco.
router.param('id', requireSucursalAccessDeRecurso('movimiento', 'id'))
router.param('movimientoId', requireSucursalAccessDeRecurso('movimiento', 'movimientoId'))

// Todas las rutas requieren autenticación.
// IMPORTANTE: esto va antes que cualquier ruta. Hasta ahora las dos rutas /bulk estaban
// declaradas ARRIBA de este requireAuth y quedaban accesibles sin autenticar.
router.use(requireAuth)
router.use(requireModule('tesoreria'))

// Acciones en bloque (deben ir antes de rutas con parámetros dinámicos)
router.delete('/bulk', requirePermission('eliminar_movimientos'), deleteBulkMovimientos)
router.put('/bulk/mover', requirePermission('editar_movimientos'), moverBulkMovimientos)

// Obtener movimientos banco de una sucursal
router.get(
  '/:sucursalId',
  requirePermission('ver_movimientos'),
  requireSucursalAccess('params', 'sucursalId'),
  getMovimientosBancoBySucursal,
)

// Obtener totales de una sucursal
router.get(
  '/:sucursalId/totales',
  requirePermission('ver_movimientos'),
  requireSucursalAccess('params', 'sucursalId'),
  getTotalesBanco,
)

// Exportar movimientos banco a Excel
router.get(
  '/:sucursalId/export',
  requirePermission('ver_movimientos'),
  requireSucursalAccess('params', 'sucursalId'),
  exportBancoToExcel,
)

// Crear movimiento banco
router.post(
  '/',
  requirePermission('crear_movimientos'),
  requireSucursalAccess('body', 'sucursal_id'),
  createMovimientoBanco,
)

// Transferencia interna entre bancos (misma sucursal)
router.post(
  '/transferencia-interna',
  requirePermission('crear_movimientos'),
  requireSucursalAccess('body', 'sucursal_id'),
  transferenciaInternaBanco,
)

// Actualizar movimiento banco
router.put('/:id', requirePermission('editar_movimientos'), updateMovimientoBanco)

// Mover movimiento a saldo real
router.put('/:id/mover-a-real', requirePermission('aprobar_movimientos'), moverAReal)

// Actualizar estado de movimiento
router.put('/:id/estado', requirePermission('aprobar_movimientos'), updateEstadoMovimientoBanco)

// Actualizar deuda de movimiento banco
router.put('/:id/deuda', requirePermission('editar_movimientos'), toggleDeudaBanco)

// Actualizar posición manual (drag & drop / inserción)
router.patch('/:id/orden', requirePermission('editar_movimientos'), updateOrdenMovimiento)

// Eliminar movimiento banco
router.delete('/:id', requirePermission('eliminar_movimientos'), deleteMovimientoBanco)

// Actualizar solo el comentario
router.patch('/:id/comentario', requirePermission('agregar_comentarios'), updateComentarioBanco)

// Documentos de movimientos banco
router.get('/:id/documentos', requirePermission('ver_movimientos'), getDocumentos)
router.post('/:id/documentos', requirePermission('crear_movimientos'), upload.single('file'), uploadDocumento)
router.get('/:movimientoId/documentos/:docId/download', requirePermission('ver_movimientos'), downloadDocumento)
router.delete('/:movimientoId/documentos/:docId', requirePermission('eliminar_movimientos'), deleteDocumento)

export default router
