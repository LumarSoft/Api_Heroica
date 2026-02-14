import { Router } from "express";
import {
    // Categorías
    getCategorias,
    createCategoria,
    updateCategoria,
    deleteCategoria,
    // Subcategorías
    getSubcategorias,
    createSubcategoria,
    updateSubcategoria,
    deleteSubcategoria,
    // Bancos
    getBancos,
    createBanco,
    updateBanco,
    deleteBanco,
    // Medios de Pago
    getMediosPago,
    createMedioPago,
    updateMedioPago,
    deleteMedioPago,
} from "../controllers/configuracionController";

const router = Router();

// ========== CATEGORÍAS ==========
router.get("/categorias", getCategorias);
router.post("/categorias", createCategoria);
router.put("/categorias/:id", updateCategoria);
router.delete("/categorias/:id", deleteCategoria);

// ========== SUBCATEGORÍAS ==========
router.get("/subcategorias", getSubcategorias);
router.post("/subcategorias", createSubcategoria);
router.put("/subcategorias/:id", updateSubcategoria);
router.delete("/subcategorias/:id", deleteSubcategoria);

// ========== BANCOS ==========
router.get("/bancos", getBancos);
router.post("/bancos", createBanco);
router.put("/bancos/:id", updateBanco);
router.delete("/bancos/:id", deleteBanco);

// ========== MEDIOS DE PAGO ==========
router.get("/medios-pago", getMediosPago);
router.post("/medios-pago", createMedioPago);
router.put("/medios-pago/:id", updateMedioPago);
router.delete("/medios-pago/:id", deleteMedioPago);

export default router;
