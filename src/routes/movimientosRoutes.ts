import { Router } from "express";
import {
  getMovimientosBySucursal,
  updateMovimiento,
  deleteMovimiento,
  updateEstadoMovimiento,
  createMovimientoEfectivo,
  moverAReal,
  getTotalesEfectivo,
  toggleDeudaEfectivo,
  moverMovimiento,
  compraVentaDivisas,
  getDeudasInterSucursal,
  deleteBulkMovimientos,
  moverBulkMovimientos,
} from "../controllers/movimientosController";
import {
  getDocumentos,
  uploadDocumento,
  deleteDocumento,
  downloadDocumento,
  upload,
} from "../controllers/documentosMovimientoController";

const router = Router();

// IMPORTANTE: Las rutas específicas deben ir ANTES de las rutas con parámetros dinámicos

// Deudas inter-sucursal (debe ir antes de /:sucursalId)
router.get("/deudas", getDeudasInterSucursal);

// Acciones en bloque (deben ir antes de rutas con parámetros dinámicos)
router.delete("/bulk", deleteBulkMovimientos);
router.put("/bulk/mover", moverBulkMovimientos);

// Crear movimiento efectivo (debe ir antes de /:sucursalId)
router.post("/efectivo", createMovimientoEfectivo);

// Compra-venta de divisas (crea 2 movimientos: USD y ARS)
router.post("/compra-venta-divisas", compraVentaDivisas);

// Mover movimiento a saldo real (debe ir antes de /:id)
router.put("/efectivo/:id/mover-a-real", moverAReal);

// Obtener totales de una sucursal (debe ir antes de /:sucursalId)
router.get("/:sucursalId/totales", getTotalesEfectivo);

// Obtener todos los movimientos de una sucursal
router.get("/:sucursalId", getMovimientosBySucursal);

// Actualizar estado de movimiento
router.put("/:id/estado", updateEstadoMovimiento);

// Actualizar deuda de movimiento
router.put("/:id/deuda", toggleDeudaEfectivo);

// Actualizar movimiento
router.put("/:id", updateMovimiento);

// Mover movimiento (internamente)
router.put("/:id/mover", moverMovimiento);

// Eliminar movimiento
router.delete("/:id", deleteMovimiento);

// Rutas para documentos de movimientos
router.get("/:id/documentos", getDocumentos);
router.post("/:id/documentos", upload.single("file"), uploadDocumento);
router.get("/:movimientoId/documentos/:docId/download", downloadDocumento);
router.delete("/:movimientoId/documentos/:docId", deleteDocumento);

export default router;
