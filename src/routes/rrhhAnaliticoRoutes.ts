import { Router } from 'express'
import { getAnaliticoGlobal } from '../controllers/rrhhAnaliticoController'
import { requireAuth, requirePermission, requireModule } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('recursos_humanos'))

router.get('/global', requirePermission('ver_analitico_rrhh'), getAnaliticoGlobal)

export default router
