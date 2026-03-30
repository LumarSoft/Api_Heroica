import { Request, Response } from "express";
import { query } from "../config/database";

// GET /api/tareas
export const getTareas = async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT t.id, t.titulo, t.descripcion, t.tipo, t.prioridad, t.estado,
              t.creado_por, u.nombre AS creado_por_nombre,
              t.created_at, t.updated_at, t.completed_at
       FROM tareas t
       LEFT JOIN usuarios u ON t.creado_por = u.id
       ORDER BY
         FIELD(t.estado, 'pendiente', 'en_progreso', 'completado', 'cancelado'),
         FIELD(t.prioridad, 'alta', 'media', 'baja'),
         t.created_at DESC`
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Error al obtener tareas:", error);
    res.status(500).json({ success: false, message: "Error al obtener tareas" });
  }
};

// POST /api/tareas
export const createTarea = async (req: Request, res: Response) => {
  try {
    const { titulo, descripcion, tipo, prioridad, creado_por } = req.body;

    if (!titulo || !tipo || !prioridad) {
      return res.status(400).json({
        success: false,
        message: "Título, tipo y prioridad son requeridos",
      });
    }

    const tiposValidos = ["bug", "mejora", "implementacion", "otro"];
    const prioridadesValidas = ["alta", "media", "baja"];

    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ success: false, message: "Tipo inválido" });
    }
    if (!prioridadesValidas.includes(prioridad)) {
      return res.status(400).json({ success: false, message: "Prioridad inválida" });
    }

    const result: any = await query(
      `INSERT INTO tareas (titulo, descripcion, tipo, prioridad, estado, creado_por)
       VALUES (?, ?, ?, ?, 'pendiente', ?)`,
      [titulo, descripcion || null, tipo, prioridad, creado_por || null]
    );

    const [newTarea]: any = await query(
      `SELECT t.id, t.titulo, t.descripcion, t.tipo, t.prioridad, t.estado,
              t.creado_por, u.nombre AS creado_por_nombre,
              t.created_at, t.updated_at, t.completed_at
       FROM tareas t
       LEFT JOIN usuarios u ON t.creado_por = u.id
       WHERE t.id = ?`,
      [result.insertId]
    );

    res.status(201).json({ success: true, data: newTarea });
  } catch (error) {
    console.error("Error al crear tarea:", error);
    res.status(500).json({ success: false, message: "Error al crear tarea" });
  }
};

// PUT /api/tareas/:id
export const updateTarea = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { titulo, descripcion, tipo, prioridad } = req.body;

    if (!titulo || !tipo || !prioridad) {
      return res.status(400).json({
        success: false,
        message: "Título, tipo y prioridad son requeridos",
      });
    }

    const existing: any = await query("SELECT id FROM tareas WHERE id = ?", [id]);
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: "Tarea no encontrada" });
    }

    await query(
      `UPDATE tareas SET titulo = ?, descripcion = ?, tipo = ?, prioridad = ?, updated_at = NOW()
       WHERE id = ?`,
      [titulo, descripcion || null, tipo, prioridad, id]
    );

    const [updated]: any = await query(
      `SELECT t.id, t.titulo, t.descripcion, t.tipo, t.prioridad, t.estado,
              t.creado_por, u.nombre AS creado_por_nombre,
              t.created_at, t.updated_at, t.completed_at
       FROM tareas t
       LEFT JOIN usuarios u ON t.creado_por = u.id
       WHERE t.id = ?`,
      [id]
    );

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error al actualizar tarea:", error);
    res.status(500).json({ success: false, message: "Error al actualizar tarea" });
  }
};

// PATCH /api/tareas/:id/estado
export const updateEstadoTarea = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const estadosValidos = ["pendiente", "en_progreso", "completado", "cancelado"];
    if (!estado || !estadosValidos.includes(estado)) {
      return res.status(400).json({ success: false, message: "Estado inválido" });
    }

    const existing: any = await query("SELECT id FROM tareas WHERE id = ?", [id]);
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: "Tarea no encontrada" });
    }

    const completedAt = estado === "completado" ? "NOW()" : "NULL";

    await query(
      `UPDATE tareas SET estado = ?, completed_at = ${completedAt}, updated_at = NOW() WHERE id = ?`,
      [estado, id]
    );

    const [updated]: any = await query(
      `SELECT t.id, t.titulo, t.descripcion, t.tipo, t.prioridad, t.estado,
              t.creado_por, u.nombre AS creado_por_nombre,
              t.created_at, t.updated_at, t.completed_at
       FROM tareas t
       LEFT JOIN usuarios u ON t.creado_por = u.id
       WHERE t.id = ?`,
      [id]
    );

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error al actualizar estado de tarea:", error);
    res.status(500).json({ success: false, message: "Error al actualizar estado" });
  }
};

// DELETE /api/tareas/:id
export const deleteTarea = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existing: any = await query("SELECT id FROM tareas WHERE id = ?", [id]);
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: "Tarea no encontrada" });
    }

    await query("DELETE FROM tareas WHERE id = ?", [id]);

    res.json({ success: true, message: "Tarea eliminada correctamente" });
  } catch (error) {
    console.error("Error al eliminar tarea:", error);
    res.status(500).json({ success: false, message: "Error al eliminar tarea" });
  }
};
