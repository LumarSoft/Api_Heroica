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
} from "../controllers/movimientosController";

const router = Router();

// IMPORTANTE: Las rutas específicas deben ir ANTES de las rutas con parámetros dinámicos

// Crear movimiento efectivo (debe ir antes de /:sucursalId)
router.post("/efectivo", createMovimientoEfectivo);

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

export default router;
