import { Router } from 'express';
import {
  getTareas,
  createTarea,
  updateTarea,
  updateEstadoTarea,
  deleteTarea,
  getUsuariosParaTareas,
} from '../controllers/tareasController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

router.use(requireAuth);

router.get('/usuarios', getUsuariosParaTareas);
router.get('/', getTareas);
router.post('/', createTarea);
router.put('/:id', updateTarea);
router.patch('/:id/estado', updateEstadoTarea);
router.delete('/:id', deleteTarea);

export default router;
