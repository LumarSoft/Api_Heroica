import { Router } from 'express';
import {
    getPagosPendientesBySucursal,
    createPagoPendiente,
    aprobarPagoPendiente,
    rechazarPagoPendiente,
    deletePagoPendiente
} from '../controllers/pagosPendientesController';

const router = Router();

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
