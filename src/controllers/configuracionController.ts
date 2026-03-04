import { Request, Response } from "express";
import { query } from "../config/database";

// ========== CATEGORÍAS ==========

// GET /api/configuracion/categorias
export const getCategorias = async (req: Request, res: Response) => {
    try {
        const { activo, tipo } = req.query;

        let sql = "SELECT * FROM categorias WHERE 1=1";
        const params: any[] = [];

        if (activo !== undefined) {
            sql += " AND activo = ?";
            params.push(activo === "true" ? 1 : 0);
        }

        if (tipo) {
            sql += " AND tipo = ?";
            params.push(tipo);
        }

        sql += " ORDER BY nombre ASC";

        const result: any = await query(sql, params);

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error("Error al obtener categorías:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener categorías",
        });
    }
};

// POST /api/configuracion/categorias
export const createCategoria = async (req: Request, res: Response) => {
    try {
        const { nombre, descripcion, tipo } = req.body;

        if (!nombre) {
            return res.status(400).json({
                success: false,
                message: "El nombre es requerido",
            });
        }

        const result: any = await query(
            "INSERT INTO categorias (nombre, descripcion, tipo) VALUES (?, ?, ?)",
            [nombre, descripcion || null, tipo || 'egreso']
        );

        const created: any = await query(
            "SELECT * FROM categorias WHERE id = ?",
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: "Categoría creada exitosamente",
            data: created[0],
        });
    } catch (error: any) {
        console.error("Error al crear categoría:", error);
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                success: false,
                message: "Ya existe una categoría con ese nombre",
            });
        }
        res.status(500).json({
            success: false,
            message: "Error al crear categoría",
        });
    }
};

// PUT /api/configuracion/categorias/:id
export const updateCategoria = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, activo, tipo } = req.body;

        await query(
            "UPDATE categorias SET nombre = ?, descripcion = ?, activo = ?, tipo = ? WHERE id = ?",
            [nombre, descripcion || null, activo !== undefined ? activo : true, tipo || 'egreso', id]
        );

        const updated: any = await query(
            "SELECT * FROM categorias WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Categoría actualizada exitosamente",
            data: updated[0],
        });
    } catch (error) {
        console.error("Error al actualizar categoría:", error);
        res.status(500).json({
            success: false,
            message: "Error al actualizar categoría",
        });
    }
};

// DELETE /api/configuracion/categorias/:id
export const deleteCategoria = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await query("DELETE FROM categorias WHERE id = ?", [id]);

        res.json({
            success: true,
            message: "Categoría eliminada exitosamente",
        });
    } catch (error) {
        console.error("Error al eliminar categoría:", error);
        res.status(500).json({
            success: false,
            message: "Error al eliminar categoría",
        });
    }
};

// ========== SUBCATEGORÍAS ==========

// GET /api/configuracion/subcategorias
export const getSubcategorias = async (req: Request, res: Response) => {
    try {
        const { categoria_id, activo } = req.query;

        let sql = `
      SELECT s.*, c.nombre as categoria_nombre 
      FROM subcategorias s
      LEFT JOIN categorias c ON s.categoria_id = c.id
      WHERE 1=1
    `;
        const params: any[] = [];

        if (categoria_id) {
            sql += " AND s.categoria_id = ?";
            params.push(categoria_id);
        }

        if (activo !== undefined) {
            sql += " AND s.activo = ?";
            params.push(activo === "true" ? 1 : 0);
        }

        sql += " ORDER BY c.nombre, s.nombre ASC";

        const result: any = await query(sql, params);

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error("Error al obtener subcategorías:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener subcategorías",
        });
    }
};

// POST /api/configuracion/subcategorias
export const createSubcategoria = async (req: Request, res: Response) => {
    try {
        const { categoria_id, nombre, descripcion } = req.body;

        if (!categoria_id || !nombre) {
            return res.status(400).json({
                success: false,
                message: "La categoría y el nombre son requeridos",
            });
        }

        const result: any = await query(
            "INSERT INTO subcategorias (categoria_id, nombre, descripcion) VALUES (?, ?, ?)",
            [categoria_id, nombre, descripcion || null]
        );

        const created: any = await query(
            "SELECT * FROM subcategorias WHERE id = ?",
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: "Subcategoría creada exitosamente",
            data: created[0],
        });
    } catch (error: any) {
        console.error("Error al crear subcategoría:", error);
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                success: false,
                message: "Ya existe una subcategoría con ese nombre en esta categoría",
            });
        }
        res.status(500).json({
            success: false,
            message: "Error al crear subcategoría",
        });
    }
};

// PUT /api/configuracion/subcategorias/:id
export const updateSubcategoria = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { categoria_id, nombre, descripcion, activo } = req.body;

        await query(
            "UPDATE subcategorias SET categoria_id = ?, nombre = ?, descripcion = ?, activo = ? WHERE id = ?",
            [categoria_id, nombre, descripcion || null, activo !== undefined ? activo : true, id]
        );

        const updated: any = await query(
            "SELECT * FROM subcategorias WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Subcategoría actualizada exitosamente",
            data: updated[0],
        });
    } catch (error) {
        console.error("Error al actualizar subcategoría:", error);
        res.status(500).json({
            success: false,
            message: "Error al actualizar subcategoría",
        });
    }
};

// DELETE /api/configuracion/subcategorias/:id
export const deleteSubcategoria = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await query("DELETE FROM subcategorias WHERE id = ?", [id]);

        res.json({
            success: true,
            message: "Subcategoría eliminada exitosamente",
        });
    } catch (error) {
        console.error("Error al eliminar subcategoría:", error);
        res.status(500).json({
            success: false,
            message: "Error al eliminar subcategoría",
        });
    }
};

// ========== BANCOS ==========

// GET /api/configuracion/bancos
export const getBancos = async (req: Request, res: Response) => {
    try {
        const { activo } = req.query;

        let sql = "SELECT * FROM bancos";
        const params: any[] = [];

        if (activo !== undefined) {
            sql += " WHERE activo = ?";
            params.push(activo === "true" ? 1 : 0);
        }

        sql += " ORDER BY nombre ASC";

        const result: any = await query(sql, params);

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error("Error al obtener bancos:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener bancos",
        });
    }
};

// POST /api/configuracion/bancos
export const createBanco = async (req: Request, res: Response) => {
    try {
        const { nombre, codigo } = req.body;

        if (!nombre) {
            return res.status(400).json({
                success: false,
                message: "El nombre es requerido",
            });
        }

        const result: any = await query(
            "INSERT INTO bancos (nombre, codigo) VALUES (?, ?)",
            [nombre, codigo || null]
        );

        const created: any = await query(
            "SELECT * FROM bancos WHERE id = ?",
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: "Banco creado exitosamente",
            data: created[0],
        });
    } catch (error: any) {
        console.error("Error al crear banco:", error);
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                success: false,
                message: "Ya existe un banco con ese nombre",
            });
        }
        res.status(500).json({
            success: false,
            message: "Error al crear banco",
        });
    }
};

// PUT /api/configuracion/bancos/:id
export const updateBanco = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { nombre, codigo, activo } = req.body;

        await query(
            "UPDATE bancos SET nombre = ?, codigo = ?, activo = ? WHERE id = ?",
            [nombre, codigo || null, activo !== undefined ? activo : true, id]
        );

        const updated: any = await query(
            "SELECT * FROM bancos WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Banco actualizado exitosamente",
            data: updated[0],
        });
    } catch (error) {
        console.error("Error al actualizar banco:", error);
        res.status(500).json({
            success: false,
            message: "Error al actualizar banco",
        });
    }
};

// DELETE /api/configuracion/bancos/:id
export const deleteBanco = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await query("DELETE FROM bancos WHERE id = ?", [id]);

        res.json({
            success: true,
            message: "Banco eliminado exitosamente",
        });
    } catch (error) {
        console.error("Error al eliminar banco:", error);
        res.status(500).json({
            success: false,
            message: "Error al eliminar banco",
        });
    }
};

// ========== MEDIOS DE PAGO ==========

// GET /api/configuracion/medios-pago
export const getMediosPago = async (req: Request, res: Response) => {
    try {
        const { activo } = req.query;

        let sql = "SELECT * FROM medios_pago";
        const params: any[] = [];

        if (activo !== undefined) {
            sql += " WHERE activo = ?";
            params.push(activo === "true" ? 1 : 0);
        }

        sql += " ORDER BY nombre ASC";

        const result: any = await query(sql, params);

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error("Error al obtener medios de pago:", error);
        res.status(500).json({
            success: false,
            message: "Error al obtener medios de pago",
        });
    }
};

// POST /api/configuracion/medios-pago
export const createMedioPago = async (req: Request, res: Response) => {
    try {
        const { nombre, descripcion } = req.body;

        if (!nombre) {
            return res.status(400).json({
                success: false,
                message: "El nombre es requerido",
            });
        }

        const result: any = await query(
            "INSERT INTO medios_pago (nombre, descripcion) VALUES (?, ?)",
            [nombre, descripcion || null]
        );

        const created: any = await query(
            "SELECT * FROM medios_pago WHERE id = ?",
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: "Medio de pago creado exitosamente",
            data: created[0],
        });
    } catch (error: any) {
        console.error("Error al crear medio de pago:", error);
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(400).json({
                success: false,
                message: "Ya existe un medio de pago con ese nombre",
            });
        }
        res.status(500).json({
            success: false,
            message: "Error al crear medio de pago",
        });
    }
};

// PUT /api/configuracion/medios-pago/:id
export const updateMedioPago = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, activo } = req.body;

        await query(
            "UPDATE medios_pago SET nombre = ?, descripcion = ?, activo = ? WHERE id = ?",
            [nombre, descripcion || null, activo !== undefined ? activo : true, id]
        );

        const updated: any = await query(
            "SELECT * FROM medios_pago WHERE id = ?",
            [id]
        );

        res.json({
            success: true,
            message: "Medio de pago actualizado exitosamente",
            data: updated[0],
        });
    } catch (error) {
        console.error("Error al actualizar medio de pago:", error);
        res.status(500).json({
            success: false,
            message: "Error al actualizar medio de pago",
        });
    }
};

// DELETE /api/configuracion/medios-pago/:id
export const deleteMedioPago = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        await query("DELETE FROM medios_pago WHERE id = ?", [id]);

        res.json({
            success: true,
            message: "Medio de pago eliminado exitosamente",
        });
    } catch (error) {
        console.error("Error al eliminar medio de pago:", error);
        res.status(500).json({
            success: false,
            message: "Error al eliminar medio de pago",
        });
    }
};
