import { Router } from 'express';
import { login, verifyToken, changePassword } from '../controllers/authController';

const router = Router();

// Ruta de login
router.post('/login', login);

// Ruta para verificar token
router.post('/verify', verifyToken);

// Ruta para cambiar contraseña propia
router.put('/change-password', changePassword);

export default router;
