import { Router } from 'express';
import { login, verifyToken } from '../controllers/authController';

const router = Router();

// Ruta de login
router.post('/login', login);

// Ruta para verificar token
router.post('/verify', verifyToken);

export default router;
