import { Router } from "express";
import { getReportesBySucursal } from "../controllers/reportesController";

const router = Router();

// Todas las rutas en este archivo empiezan con /api/reportes
router.get("/:sucursalId", getReportesBySucursal);

export default router;
