import { Router } from 'express';
import { login, verifyToken, verify2FA, enable2FA, confirm2FA, disable2FA, reset2FA } from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.post('/verify', verifyToken);
router.post('/verify-2fa', verify2FA);
router.post('/enable-2fa', enable2FA);
router.post('/confirm-2fa', confirm2FA);
router.post('/disable-2fa', disable2FA);
router.post('/reset-2fa', reset2FA);

export default router;
