import { Router } from 'express'
import { getAnaliticoGlobal } from '../controllers/rrhhAnaliticoController'
import { requireAuth, requireModule } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('recursos_humanos'))

router.get('/global', getAnaliticoGlobal)

export default router
