import { Router } from 'express';
import {
  getMovimientosBySucursal,
  updateMovimiento,
  deleteMovimiento,
  updateEstadoMovimiento,
  createMovimientoEfectivo,
  moverAReal,
  getTotalesEfectivo
} from '../controllers/movimientosController';

const router = Router();

// Obtener todos los movimientos de una sucursal
router.get('/:sucursalId', getMovimientosBySucursal);

// Obtener totales de una sucursal
router.get('/:sucursalId/totales', getTotalesEfectivo);

// Crear movimiento efectivo
router.post('/efectivo', createMovimientoEfectivo);

// Actualizar movimiento
router.put('/:id', updateMovimiento);

// Mover movimiento a saldo real
router.put('/efectivo/:id/mover-a-real', moverAReal);

// Actualizar estado de movimiento
router.put('/:id/estado', updateEstadoMovimiento);

// Eliminar movimiento
router.delete('/:id', deleteMovimiento);

export default router;

