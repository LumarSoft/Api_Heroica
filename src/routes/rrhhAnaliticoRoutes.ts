import { Router } from 'express'
import { getAnaliticoGlobal } from '../controllers/rrhhAnaliticoController'
import { requireAuth, requireModule } from '../middlewares/authMiddleware'

const router = Router()

router.use(requireAuth)
router.use(requireModule('recursos_humanos'))

// Sin requirePermission: alcanza con tener el módulo recursos_humanos. Agregar
// ver_analitico_rrhh se revirtió por decisión del responsable, para no tocar el esquema de
// permisos que hoy funciona.
router.get('/global', getAnaliticoGlobal)

export default router
