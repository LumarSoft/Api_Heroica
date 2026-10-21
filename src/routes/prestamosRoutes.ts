import { Router } from 'express'
import {
  getEstadoCuenta,
  getPendientesDevolver,
  getPorConfirmar,
  getSucursales,
  postAceptar,
  postAnular,
  postAnularDevolucion,
  postCancelar,
  postConfirmarDevolucion,
  postDevolucion,
  postPrestamo,
  postRechazar,
  postRechazarDevolucion,
} from '../controllers/prestamosController'
import { requireAuth, requireModule, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('tesoreria'))

// Consultas (el acceso a la sucursal se valida en el servicio)
router.get('/sucursales', requirePermission('ver_movimientos'), getSucursales)
router.get('/:sucursalId/estado-cuenta', requirePermission('ver_movimientos'), getEstadoCuenta)
router.get('/:sucursalId/por-confirmar', requirePermission('ver_movimientos'), getPorConfirmar)
router.get('/:sucursalId/pendientes-devolver', requirePermission('ver_movimientos'), getPendientesDevolver)

// Devoluciones (antes de las rutas con /:id)
router.post('/devoluciones/:id/confirmar', requirePermission('aprobar_movimientos'), postConfirmarDevolucion)
router.post('/devoluciones/:id/rechazar', requirePermission('aprobar_movimientos'), postRechazarDevolucion)
router.post('/devoluciones/:id/anular', requirePermission('aprobar_movimientos'), postAnularDevolucion)

// Pedir un préstamo y operar sobre él
router.post('/', requirePermission('crear_movimientos'), postPrestamo)
router.post('/:id/aceptar', requirePermission('aprobar_movimientos'), postAceptar)
router.post('/:id/rechazar', requirePermission('aprobar_movimientos'), postRechazar)
router.post('/:id/cancelar', requirePermission('crear_movimientos'), postCancelar)
router.post('/:id/anular', requirePermission('aprobar_movimientos'), postAnular)
router.post('/:id/devoluciones', requirePermission('crear_movimientos'), postDevolucion)

export default router
