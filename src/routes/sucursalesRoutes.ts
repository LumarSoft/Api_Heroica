import { Router } from 'express';
import { getSucursales, getSucursalById, createSucursal, updateSucursal, deleteSucursal } from '../controllers/sucursalesController';

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

export default router;

