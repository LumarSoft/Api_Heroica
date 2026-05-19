import { Router } from 'express'
import { getSueldosPeriodo, updateSueldoPeriodo, updateSueldoPeriodoMeta } from '../controllers/rrhhSueldosController'
import { requireAuth, requirePermission } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('ver_sueldos'), getSueldosPeriodo)
router.put('/:personalId/periodo/meta', requirePermission('ver_sueldos'), updateSueldoPeriodoMeta)
router.put('/:personalId/periodo', requirePermission('ver_sueldos'), updateSueldoPeriodo)

export default router
