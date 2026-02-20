import { Router } from 'express';
import {
    getMovimientosBancoBySucursal,
    createMovimientoBanco,
    updateMovimientoBanco,
    deleteMovimientoBanco,
    moverARealBanco as moverAReal,
    getTotalesBanco,
    updateEstadoMovimientoBanco
} from '../controllers/movimientosController';

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

// Eliminar movimiento banco
router.delete('/:id', deleteMovimientoBanco);

export default router;
