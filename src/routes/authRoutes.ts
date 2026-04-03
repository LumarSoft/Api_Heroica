import { Router } from "express";
import { login, verifyToken, changePassword } from "../controllers/authController";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

// Login: público (no requiere auth)
router.post("/login", login);

// Verificar token: público (es el endpoint que comprueba si hay sesión activa)
router.post("/verify", verifyToken);

// Cambiar contraseña propia: requiere estar autenticado
router.put("/change-password", requireAuth, changePassword);

export default router;
