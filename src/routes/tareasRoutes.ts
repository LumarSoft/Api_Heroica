import { Router } from "express";
import {
  getTareas,
  createTarea,
  updateTarea,
  updateEstadoTarea,
  deleteTarea,
} from "../controllers/tareasController";

const router = Router();

router.get("/", getTareas);
router.post("/", createTarea);
router.put("/:id", updateTarea);
router.patch("/:id/estado", updateEstadoTarea);
router.delete("/:id", deleteTarea);

export default router;
