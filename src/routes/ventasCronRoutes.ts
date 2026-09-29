import { Router } from 'express'
import { getCronVentas } from '../controllers/ventasIntegracionesController'

/**
 * Rutas invocadas por Vercel Cron. Van fuera de requireAuth: se autentican con
 * CRON_SECRET dentro del controlador. Se montan ANTES que /api/ventas.
 */
const router = Router()

router.get('/', getCronVentas)

export default router
