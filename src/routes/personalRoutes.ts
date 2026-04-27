import { Router } from 'express'
import { getPersonal, getPersonalById, createPersonal, updatePersonal, deletePersonal } from '../controllers/personalController'
import { requireAuth } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', getPersonal)
router.get('/:id', getPersonalById)
router.post('/', createPersonal)
router.put('/:id', updatePersonal)
router.delete('/:id', deletePersonal)

export default router
