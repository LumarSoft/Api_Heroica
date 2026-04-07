import { Router } from 'express';
import { liveness, readiness } from '../controllers/healthController';

const router = Router();

// GET /health — liveness check
router.get('/health', liveness);

// GET /ready — readiness check (verifica conexión a MySQL)
router.get('/ready', readiness);

export default router;
