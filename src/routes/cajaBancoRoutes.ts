import { Router } from 'express';
import {
    getMovimientosBancoBySucursal,
    createMovimientoBanco,
    updateMovimientoBanco,
    deleteMovimientoBanco,
    moverARealBanco as moverAReal,
    getTotalesBanco,
    updateEstadoMovimientoBanco,
    toggleDeudaBanco,
} from '../controllers/movimientosController';
import {
    getDocumentos,
    uploadDocumento,
    deleteDocumento,
    downloadDocumento,
    upload
} from '../controllers/documentosMovimientoController';

const router = Router();

// Obtener movimientos banco de una sucursal
router.get('/:sucursalId', getMovimientosBancoBySucursal);

// Obtener totales de una sucursal
router.get('/:sucursalId/totales', getTotalesBanco);

// Crear movimiento banco
router.post('/', createMovimientoBanco);

// Actualizar movimiento banco
router.put('/:id', updateMovimientoBanco);

// Mover movimiento a saldo real
router.put('/:id/mover-a-real', moverAReal);

// Actualizar estado de movimiento
router.put('/:id/estado', updateEstadoMovimientoBanco);

// Actualizar deuda de movimiento banco
router.put('/:id/deuda', toggleDeudaBanco);

// Eliminar movimiento banco
router.delete('/:id', deleteMovimientoBanco);

// Rutas para documentos de movimientos banco
router.get('/:id/documentos', getDocumentos);
router.post('/:id/documentos', upload.single('file'), uploadDocumento);
router.get('/:movimientoId/documentos/:docId/download', downloadDocumento);
router.delete('/:movimientoId/documentos/:docId', deleteDocumento);

export default router;
