import { Router } from 'express'
import { liveness, readiness, emailCheck } from '../controllers/healthController'

const router = Router()

// GET /health — liveness check
router.get('/health', liveness)

// GET /ready — readiness check (verifica conexión a MySQL)
router.get('/ready', readiness)

// GET /email-check?secret=... — diagnóstico de email (debugging)
router.get('/email-check', emailCheck)

export default router
