import { Router } from 'express'
import {
  confirmarImportacion,
  getBancosSoportados,
  getHistorial,
  previewImportacion,
  revertirImportacion,
  upload,
} from '../controllers/importacionBancariaController'
import { requireAuth, requireModule, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('tesoreria'))

// Bancos con importador disponible (para el selector del front)
router.get('/bancos', requirePermission('importar_movimientos'), getBancosSoportados)

// Paso 1: leer el archivo y devolver qué se va a crear. No escribe nada.
router.post('/preview', requirePermission('importar_movimientos'), upload.single('archivo'), previewImportacion)

// Paso 2: impactar en la caja.
router.post('/confirmar', requirePermission('importar_movimientos'), upload.single('archivo'), confirmarImportacion)

// Historial de importaciones de una sucursal
router.get('/:sucursalId/historial', requirePermission('ver_movimientos'), getHistorial)

// Deshacer una importación completa
router.post('/:id/revertir', requirePermission('revertir_importaciones'), revertirImportacion)

export default router
