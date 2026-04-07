import { Router } from 'express';
import {
  getCuentasBancarias,
  createCuentaBancaria,
  updateCuentaBancaria,
  deleteCuentaBancaria,
} from '../controllers/cuentasBancariasController';
import { requireAuth, requirePermission } from '../middlewares/authMiddleware';

const router = Router();

// Todas las rutas requieren autenticación
router.use(requireAuth);

// Rutas base: /api/cuentas-bancarias
// Las cuentas bancarias forman parte de la gestión de sucursales
router.get(
  '/:sucursalId',
  requirePermission('ver_sucursales'),
  getCuentasBancarias,
);
router.post(
  '/:sucursalId',
  requirePermission('gestionar_sucursales'),
  createCuentaBancaria,
);
router.put(
  '/:id',
  requirePermission('gestionar_sucursales'),
  updateCuentaBancaria,
);
router.delete(
  '/:id',
  requirePermission('gestionar_sucursales'),
  deleteCuentaBancaria,
);

export default router;
