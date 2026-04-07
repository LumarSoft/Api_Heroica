import { Router } from 'express';
import {
  getTareas,
  createTarea,
  updateTarea,
  updateEstadoTarea,
  deleteTarea,
} from '../controllers/tareasController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// Todas las rutas requieren autenticación.
// Las tareas son visibles para cualquier usuario autenticado (no tienen permiso granular propio).
// Al agregar el módulo de tareas con permisos granulares, actualizar aquí y en permisos.ts.
router.use(requireAuth);

router.get('/', getTareas);
router.post('/', createTarea);
router.put('/:id', updateTarea);
router.patch('/:id/estado', updateEstadoTarea);
router.delete('/:id', deleteTarea);

export default router;
