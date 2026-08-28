import { Router } from 'express'
import {
  getPersonal,
  getPersonalById,
  createPersonal,
  updatePersonal,
  deletePersonal,
  getPersonalArchivos,
  getAlertasDocumentacion,
} from '../controllers/personalController'
import {
  getProfesional,
  getAnalitico,
  getNotas,
  createNota,
  deleteNota,
} from '../controllers/personalProfesionalController'
import {
  uploadDocumento,
  createPersonalDocumento,
  deletePersonalDocumento,
  openPersonalArchivo,
  getRecibosSueldo,
  createReciboSueldo,
  openReciboSueldo,
  deleteReciboSueldo,
} from '../controllers/personalDocumentosController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('recursos_humanos'))

router.get('/', requirePermission('ver_personal'), getPersonal)
router.get('/alertas-documentacion', requirePermission('ver_personal'), getAlertasDocumentacion)
router.get('/:id', requirePermission('ver_personal'), getPersonalById)
router.post('/', requirePermission('crear_personal'), createPersonal)
router.put('/:id', requirePermission('gestionar_personal'), updatePersonal)
router.delete('/:id', requirePermission('eliminar_personal'), deletePersonal)

router.get('/:id/profesional', requirePermission('ver_personal'), getProfesional)
router.get('/:id/analitico', requirePermission('ver_personal'), getAnalitico)
router.get('/:id/archivos', requirePermission('ver_personal'), getPersonalArchivos)
router.post('/:id/archivos/abrir', requirePermission('ver_personal'), openPersonalArchivo)
router.get('/:id/recibos-sueldo', requirePermission('ver_personal'), getRecibosSueldo)
router.post(
  '/:id/recibos-sueldo',
  requirePermission('gestionar_personal'),
  uploadDocumento.single('file'),
  createReciboSueldo,
)
router.post('/:id/recibos-sueldo/:reciboId/abrir', requirePermission('ver_personal'), openReciboSueldo)
router.delete('/:id/recibos-sueldo/:reciboId', requirePermission('gestionar_personal'), deleteReciboSueldo)
router.get('/:id/notas', requirePermission('ver_personal'), getNotas)
router.post('/:id/notas', requirePermission('gestionar_personal'), createNota)
router.delete('/:id/notas/:notaId', requirePermission('gestionar_personal'), deleteNota)
router.post(
  '/:id/documentos',
  requirePermission('gestionar_personal'),
  uploadDocumento.single('file'),
  createPersonalDocumento,
)
router.delete('/:id/documentos/:docId', requirePermission('gestionar_personal'), deletePersonalDocumento)

export default router
