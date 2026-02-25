import { Router } from 'express';
import {
    getPagosPendientesBySucursal,
    getAllPagosPendientes,
    createPagoPendiente,
    aprobarPagoPendiente,
    rechazarPagoPendiente,
    deletePagoPendiente,
    getHistorialByUser
} from '../controllers/movimientosController';

const router = Router();

// Obtener historial de un usuario
router.get('/historial/:userId', getHistorialByUser);

// Obtener todos los pagos pendientes
router.get('/all', getAllPagosPendientes);

// Obtener pagos pendientes de una sucursal
router.get('/:sucursalId', getPagosPendientesBySucursal);

// Crear nuevo pago pendiente
router.post('/', createPagoPendiente);

// Aprobar pago pendiente
router.put('/:id/aprobar', aprobarPagoPendiente);

// Rechazar pago pendiente
router.put('/:id/rechazar', rechazarPagoPendiente);

// Eliminar pago pendiente
router.delete('/:id', deletePagoPendiente);

export default router;
