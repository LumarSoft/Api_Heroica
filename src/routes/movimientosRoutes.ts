import { Router } from 'express';
import { 
  getMovimientosBySucursal, 
  updateMovimiento, 
  deleteMovimiento,
  updateEstadoMovimiento 
} from '../controllers/movimientosController';

const router = Router();

// Obtener todos los movimientos de una sucursal
router.get('/:sucursalId', getMovimientosBySucursal);

// Actualizar movimiento
router.put('/:id', updateMovimiento);

// Actualizar estado de movimiento
router.put('/:id/estado', updateEstadoMovimiento);

// Eliminar movimiento
router.delete('/:id', deleteMovimiento);

export default router;
