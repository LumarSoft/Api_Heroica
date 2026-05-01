import { Router } from 'express'
import { getSueldosPeriodo } from '../controllers/rrhhSueldosController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('ver_sueldos'), getSueldosPeriodo)

export default router
