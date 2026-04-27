import { Router } from 'express'
import { getPuestos, createPuesto, updatePuesto, deletePuesto } from '../controllers/puestosController'
import { requireAuth } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', getPuestos)
router.post('/', createPuesto)
router.put('/:id', updatePuesto)
router.delete('/:id', deletePuesto)

export default router
