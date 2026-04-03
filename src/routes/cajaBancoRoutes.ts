import { Router } from "express";
import {
  getMovimientosBancoBySucursal,
  createMovimientoBanco,
  updateMovimientoBanco,
  deleteMovimientoBanco,
  moverARealBanco as moverAReal,
  getTotalesBanco,
  updateEstadoMovimientoBanco,
  toggleDeudaBanco,
} from "../controllers/movimientosController";
import {
  getDocumentos,
  uploadDocumento,
  deleteDocumento,
  downloadDocumento,
  upload,
} from "../controllers/documentosMovimientoController";
import { requireAuth, requirePermission } from "../middlewares/authMiddleware";

const router = Router();

// Todas las rutas requieren autenticación
router.use(requireAuth);

// Obtener movimientos banco de una sucursal
router.get("/:sucursalId", requirePermission("ver_movimientos"), getMovimientosBancoBySucursal);

// Obtener totales de una sucursal
router.get("/:sucursalId/totales", requirePermission("ver_movimientos"), getTotalesBanco);

// Crear movimiento banco
router.post("/", requirePermission("crear_movimientos"), createMovimientoBanco);

// Actualizar movimiento banco
router.put("/:id", requirePermission("editar_movimientos"), updateMovimientoBanco);

// Mover movimiento a saldo real
router.put("/:id/mover-a-real", requirePermission("aprobar_movimientos"), moverAReal);

// Actualizar estado de movimiento
router.put("/:id/estado", requirePermission("aprobar_movimientos"), updateEstadoMovimientoBanco);

// Actualizar deuda de movimiento banco
router.put("/:id/deuda", requirePermission("editar_movimientos"), toggleDeudaBanco);

// Eliminar movimiento banco
router.delete("/:id", requirePermission("eliminar_movimientos"), deleteMovimientoBanco);

// Documentos de movimientos banco
router.get("/:id/documentos", requirePermission("ver_movimientos"), getDocumentos);
router.post("/:id/documentos", requirePermission("crear_movimientos"), upload.single("file"), uploadDocumento);
router.get("/:movimientoId/documentos/:docId/download", requirePermission("ver_movimientos"), downloadDocumento);
router.delete("/:movimientoId/documentos/:docId", requirePermission("eliminar_movimientos"), deleteDocumento);

export default router;
