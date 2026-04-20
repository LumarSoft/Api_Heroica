import { Router } from 'express'
import {
  getTareas,
  createTarea,
  updateTarea,
  updateEstadoTarea,
  deleteTarea,
  getUsuariosParaTareas,
  getComentarios,
  createComentario,
  deleteComentario,
  asignarTarea,
} from '../controllers/tareasController'
import { requireAuth } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/usuarios', getUsuariosParaTareas)
router.get('/', getTareas)
router.post('/', createTarea)
router.put('/:id', updateTarea)
router.patch('/:id/estado', updateEstadoTarea)
router.patch('/:id/asignar', asignarTarea)
router.delete('/:id', deleteTarea)

router.get('/:id/comentarios', getComentarios)
router.post('/:id/comentarios', createComentario)
router.delete('/:id/comentarios/:comentarioId', deleteComentario)

export default router
