import { Router } from 'express'
import {
  cancelSolicitud,
  createSolicitud,
  deleteSolicitud,
  getSolicitudById,
  getSolicitudes,
  updateEstadoSolicitud,
  updateSolicitud,
} from '../controllers/rrhhSolicitudesController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('ver_solicitudes'), getSolicitudes)
router.get('/:id', requirePermission('ver_solicitudes'), getSolicitudById)
router.post('/', requirePermission('crear_solicitudes'), createSolicitud)
router.put('/:id', requirePermission('editar_solicitudes'), updateSolicitud)
router.patch('/:id/estado', requirePermission('aprobar_solicitudes'), updateEstadoSolicitud)
router.patch('/:id/cancelar', requirePermission('cancelar_solicitudes'), cancelSolicitud)
router.delete('/:id', requirePermission('crear_solicitudes'), deleteSolicitud)

export default router
