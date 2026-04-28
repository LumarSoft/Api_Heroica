import { Router } from 'express'
import { createSolicitud, getSolicitudes, updateEstadoSolicitud, deleteSolicitud } from '../controllers/rrhhSolicitudesController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

// Nota: se usan permisos como 'ver_solicitudes' y 'gestionar_solicitudes'. 
// Asegurarse de que estén definidos en la base de datos de permisos.
router.get('/', requirePermission('ver_solicitudes'), getSolicitudes)
router.post('/', requirePermission('gestionar_solicitudes'), createSolicitud)
router.put('/:id/estado', requirePermission('gestionar_solicitudes'), updateEstadoSolicitud)
router.delete('/:id', requirePermission('gestionar_solicitudes'), deleteSolicitud)

export default router
