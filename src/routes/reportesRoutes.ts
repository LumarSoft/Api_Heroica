import { Router } from "express";
import { getReportesBySucursal } from "../controllers/reportesController";
import { requireAuth, requirePermission } from "../middlewares/authMiddleware";

const router = Router();

// Todas las rutas requieren autenticación
router.use(requireAuth);

router.get("/:sucursalId", requirePermission("ver_reportes"), getReportesBySucursal);

export default router;
