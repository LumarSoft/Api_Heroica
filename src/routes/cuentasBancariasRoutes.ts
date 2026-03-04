import { Router } from 'express';
import {
  getCuentasBancarias,
  createCuentaBancaria,
  updateCuentaBancaria,
  deleteCuentaBancaria
} from '../controllers/cuentasBancariasController';

const router = Router();

// Rutas base: /api/cuentas-bancarias
router.get('/:sucursalId', getCuentasBancarias);
router.post('/:sucursalId', createCuentaBancaria);
router.put('/:id', updateCuentaBancaria);
router.delete('/:id', deleteCuentaBancaria);

export default router;
