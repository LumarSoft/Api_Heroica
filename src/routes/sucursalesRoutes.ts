import { Router } from 'express';
import { getSucursales, getSucursalById, createSucursal, updateSucursal, deleteSucursal } from '../controllers/sucursalesController';
import { upload, getDocumentos, uploadDocumento, deleteDocumento, downloadDocumento } from '../controllers/documentacionController';

const router = Router();

// Obtener todas las sucursales
router.get('/', getSucursales);

// Obtener una sucursal por ID
router.get('/:id', getSucursalById);

// Crear nueva sucursal
router.post('/', createSucursal);

// Actualizar sucursal
router.put('/:id', updateSucursal);

// Eliminar sucursal (soft delete)
router.delete('/:id', deleteSucursal);

// ========== DOCUMENTACIÓN (MÚLTIPLES ARCHIVOS) ==========

// Obtener todos los documentos de una sucursal
router.get('/:id/documentos', getDocumentos);

// Subir nuevo documento
router.post('/:id/documentos', upload.single('file'), uploadDocumento);

// Descargar documento específico
router.get('/:sucursalId/documentos/:docId/download', downloadDocumento);

// Eliminar documento específico
router.delete('/:sucursalId/documentos/:docId', deleteDocumento);

export default router;
