import { Router } from "express";
import {
  getSucursales,
  getSucursalById,
  createSucursal,
  updateSucursal,
  deleteSucursal,
} from "../controllers/sucursalesController";
import {
  upload,
  getDocumentos,
  uploadDocumento,
  deleteDocumento,
  downloadDocumento,
} from "../controllers/documentacionController";
import { requireAuth, requirePermission } from "../middlewares/authMiddleware";

const router = Router();

// Todas las rutas requieren autenticación
router.use(requireAuth);

// Obtener todas las sucursales (filtrado por usuario en el controller)
router.get("/", requirePermission("ver_sucursales"), getSucursales);

// Obtener una sucursal por ID
router.get("/:id", requirePermission("ver_sucursales"), getSucursalById);

// Crear nueva sucursal
router.post("/", requirePermission("gestionar_sucursales"), createSucursal);

// Actualizar sucursal
router.put("/:id", requirePermission("gestionar_sucursales"), updateSucursal);

// Eliminar sucursal (soft delete)
router.delete("/:id", requirePermission("gestionar_sucursales"), deleteSucursal);

// Documentación de sucursales
router.get("/:id/documentos", requirePermission("ver_sucursales"), getDocumentos);
router.post("/:id/documentos", requirePermission("gestionar_sucursales"), upload.single("file"), uploadDocumento);
router.get("/:sucursalId/documentos/:docId/download", requirePermission("ver_sucursales"), downloadDocumento);
router.delete("/:sucursalId/documentos/:docId", requirePermission("gestionar_sucursales"), deleteDocumento);

export default router;
