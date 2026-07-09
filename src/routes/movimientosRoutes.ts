import { Router } from 'express'
import {
  getMovimientosBySucursal,
  updateMovimiento,
  deleteMovimiento,
  updateEstadoMovimiento,
  createMovimientoEfectivo,
  moverAReal,
  getTotalesEfectivo,
  toggleDeudaEfectivo,
  moverMovimiento,
  compraVentaDivisas,
  getDeudasInterSucursal,
  deleteBulkMovimientos,
  moverBulkMovimientos,
  updateComentarioEfectivo,
  updateOrdenMovimiento,
} from '../controllers/movimientosController'
import { exportEfectivoToExcel } from '../controllers/exportController'
import {
  getDocumentos,
  uploadDocumento,
  deleteDocumento,
  downloadDocumento,
  upload,
} from '../controllers/documentosMovimientoController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)
router.use(requireModule('tesoreria'))

// IMPORTANTE: Las rutas específicas deben ir ANTES de las rutas con parámetros dinámicos

// Deudas inter-sucursal
router.get('/deudas', requirePermission('ver_movimientos'), getDeudasInterSucursal)

// Acciones en bloque (deben ir antes de rutas con parámetros dinámicos)
router.delete('/bulk', deleteBulkMovimientos)
router.put('/bulk/mover', moverBulkMovimientos)

// Crear movimiento efectivo (debe ir antes de /:sucursalId)
router.post('/efectivo', requirePermission('crear_movimientos'), createMovimientoEfectivo)

// Compra-venta de divisas
router.post('/compra-venta-divisas', requirePermission('crear_movimientos'), compraVentaDivisas)

// Mover movimiento a saldo real
router.put('/efectivo/:id/mover-a-real', requirePermission('aprobar_movimientos'), moverAReal)

// Obtener totales de una sucursal
router.get('/:sucursalId/totales', requirePermission('ver_movimientos'), getTotalesEfectivo)

// Exportar movimientos efectivo a Excel
router.get('/:sucursalId/export', requirePermission('ver_movimientos'), exportEfectivoToExcel)

// Obtener todos los movimientos de una sucursal
router.get('/:sucursalId', requirePermission('ver_movimientos'), getMovimientosBySucursal)

// Actualizar estado de movimiento
router.put('/:id/estado', requirePermission('aprobar_movimientos'), updateEstadoMovimiento)

// Actualizar deuda de movimiento
router.put('/:id/deuda', requirePermission('editar_movimientos'), toggleDeudaEfectivo)

// Actualizar posición manual (drag & drop / inserción)
router.patch('/:id/orden', requirePermission('editar_movimientos'), updateOrdenMovimiento)

// Mover movimiento (internamente entre sucursales)
router.put('/:id/mover', requirePermission('editar_movimientos'), moverMovimiento)

// Actualizar movimiento
router.put('/:id', requirePermission('editar_movimientos'), updateMovimiento)

// Actualizar solo comentario
router.patch('/:id/comentario', requirePermission('agregar_comentarios'), updateComentarioEfectivo)

// Eliminar movimiento
router.delete('/:id', requirePermission('eliminar_movimientos'), deleteMovimiento)

// Documentos de movimientos
router.get('/:id/documentos', requirePermission('ver_movimientos'), getDocumentos)
router.post('/:id/documentos', requirePermission('crear_movimientos'), upload.single('file'), uploadDocumento)
router.get('/:movimientoId/documentos/:docId/download', requirePermission('ver_movimientos'), downloadDocumento)
router.delete('/:movimientoId/documentos/:docId', requirePermission('eliminar_movimientos'), deleteDocumento)

export default router
