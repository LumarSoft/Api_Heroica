import { Request, Response } from 'express'
import { query } from '../config/database'

// GET /api/tareas/usuarios
export const getUsuariosParaTareas = async (_req: Request, res: Response) => {
  try {
    const result = await query(`SELECT id, nombre FROM usuarios WHERE deleted_at IS NULL ORDER BY nombre ASC`)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener usuarios:', error)
    res.status(500).json({ success: false, message: 'Error al obtener usuarios' })
  }
}

// GET /api/tareas
export const getTareas = async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT t.id, t.codigo, t.version, t.titulo, t.descripcion, t.tipo, t.prioridad, t.estado,
              t.creado_por, uc.nombre AS creado_por_nombre,
              t.asignado_a, ua.nombre AS asignado_a_nombre,
              t.created_at, t.updated_at, t.completed_at,
              (SELECT COUNT(*) FROM tareas_comentarios tc WHERE tc.tarea_id = t.id AND tc.deleted_at IS NULL) AS comentarios_count
       FROM tareas t
       LEFT JOIN usuarios uc ON t.creado_por = uc.id
       LEFT JOIN usuarios ua ON t.asignado_a = ua.id
       WHERE t.deleted_at IS NULL
       ORDER BY
         FIELD(t.estado, 'pendiente', 'en_progreso', 'en_pruebas', 'completado'),
         FIELD(t.prioridad, 'alta', 'media', 'baja'),
         t.created_at DESC`,
    )
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener tareas:', error)
    res.status(500).json({ success: false, message: 'Error al obtener tareas' })
  }
}

// POST /api/tareas
export const createTarea = async (req: Request, res: Response) => {
  try {
    const { titulo, descripcion, tipo, prioridad, version, creado_por, asignado_a } = req.body

    if (!titulo || !tipo || !prioridad) {
      return res.status(400).json({ success: false, message: 'Título, tipo y prioridad son requeridos' })
    }

    const tiposValidos = ['bug', 'mejora', 'implementacion', 'otro']
    const prioridadesValidas = ['alta', 'media', 'baja']

    if (!tiposValidos.includes(tipo)) return res.status(400).json({ success: false, message: 'Tipo inválido' })
    if (!prioridadesValidas.includes(prioridad)) return res.status(400).json({ success: false, message: 'Prioridad inválida' })

    const lastTarea: any = await query(`SELECT codigo FROM tareas ORDER BY id DESC LIMIT 1`)

    let nuevoCodigo = 'TE-01'
    if (Array.isArray(lastTarea) && lastTarea.length > 0 && lastTarea[0].codigo) {
      const lastNumber = parseInt(lastTarea[0].codigo.split('-')[1])
      nuevoCodigo = `TE-${String(lastNumber + 1).padStart(2, '0')}`
    }

    const result: any = await query(
      `INSERT INTO tareas (codigo, version, titulo, descripcion, tipo, prioridad, estado, creado_por, asignado_a)
       VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
      [nuevoCodigo, version || null, titulo, descripcion || null, tipo, prioridad, creado_por || null, asignado_a || null],
    )

    const newTarea: any = await query(
      `SELECT t.id, t.codigo, t.version, t.titulo, t.descripcion, t.tipo, t.prioridad, t.estado,
              t.creado_por, uc.nombre AS creado_por_nombre,
              t.asignado_a, ua.nombre AS asignado_a_nombre,
              t.created_at, t.updated_at, t.completed_at,
              0 AS comentarios_count
       FROM tareas t
       LEFT JOIN usuarios uc ON t.creado_por = uc.id
       LEFT JOIN usuarios ua ON t.asignado_a = ua.id
       WHERE t.id = ?`,
      [result.insertId],
    )

    res.status(201).json({ success: true, data: newTarea[0] })
  } catch (error) {
    console.error('Error al crear tarea:', error)
    res.status(500).json({ success: false, message: 'Error al crear tarea' })
  }
}

// PUT /api/tareas/:id
export const updateTarea = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { titulo, descripcion, tipo, prioridad, version, asignado_a } = req.body

    if (!titulo || !tipo || !prioridad) {
      return res.status(400).json({ success: false, message: 'Título, tipo y prioridad son requeridos' })
    }

    const existing: any = await query('SELECT id FROM tareas WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Tarea no encontrada' })
    }

    await query(
      `UPDATE tareas SET titulo = ?, descripcion = ?, tipo = ?, prioridad = ?, version = ?, asignado_a = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [titulo, descripcion || null, tipo, prioridad, version || null, asignado_a || null, id],
    )

    const updated: any = await query(
      `SELECT t.id, t.codigo, t.version, t.titulo, t.descripcion, t.tipo, t.prioridad, t.estado,
              t.creado_por, uc.nombre AS creado_por_nombre,
              t.asignado_a, ua.nombre AS asignado_a_nombre,
              t.created_at, t.updated_at, t.completed_at,
              (SELECT COUNT(*) FROM tareas_comentarios tc WHERE tc.tarea_id = t.id AND tc.deleted_at IS NULL) AS comentarios_count
       FROM tareas t
       LEFT JOIN usuarios uc ON t.creado_por = uc.id
       LEFT JOIN usuarios ua ON t.asignado_a = ua.id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    )

    res.json({ success: true, data: updated[0] })
  } catch (error) {
    console.error('Error al actualizar tarea:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar tarea' })
  }
}

// PATCH /api/tareas/:id/estado
export const updateEstadoTarea = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { estado } = req.body

    const estadosValidos = ['pendiente', 'en_progreso', 'en_pruebas', 'completado']
    if (!estado || !estadosValidos.includes(estado)) {
      return res.status(400).json({ success: false, message: 'Estado inválido' })
    }

    const existing: any = await query('SELECT id FROM tareas WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Tarea no encontrada' })
    }

    const completedAt = estado === 'completado' ? 'NOW()' : 'NULL'
    await query(
      `UPDATE tareas SET estado = ?, completed_at = ${completedAt}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [estado, id],
    )

    const updated: any = await query(
      `SELECT t.id, t.codigo, t.version, t.titulo, t.descripcion, t.tipo, t.prioridad, t.estado,
              t.creado_por, uc.nombre AS creado_por_nombre,
              t.asignado_a, ua.nombre AS asignado_a_nombre,
              t.created_at, t.updated_at, t.completed_at,
              (SELECT COUNT(*) FROM tareas_comentarios tc WHERE tc.tarea_id = t.id AND tc.deleted_at IS NULL) AS comentarios_count
       FROM tareas t
       LEFT JOIN usuarios uc ON t.creado_por = uc.id
       LEFT JOIN usuarios ua ON t.asignado_a = ua.id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    )

    res.json({ success: true, data: updated[0] })
  } catch (error) {
    console.error('Error al actualizar estado de tarea:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar estado' })
  }
}

// PATCH /api/tareas/:id/asignar
export const asignarTarea = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { asignado_a } = req.body

    const existing: any = await query('SELECT id FROM tareas WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Tarea no encontrada' })
    }

    await query(
      `UPDATE tareas SET asignado_a = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [asignado_a || null, id],
    )

    const updated: any = await query(
      `SELECT t.id, t.codigo, t.version, t.titulo, t.descripcion, t.tipo, t.prioridad, t.estado,
              t.creado_por, uc.nombre AS creado_por_nombre,
              t.asignado_a, ua.nombre AS asignado_a_nombre,
              t.created_at, t.updated_at, t.completed_at,
              (SELECT COUNT(*) FROM tareas_comentarios tc WHERE tc.tarea_id = t.id AND tc.deleted_at IS NULL) AS comentarios_count
       FROM tareas t
       LEFT JOIN usuarios uc ON t.creado_por = uc.id
       LEFT JOIN usuarios ua ON t.asignado_a = ua.id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    )

    res.json({ success: true, data: updated[0] })
  } catch (error) {
    console.error('Error al asignar tarea:', error)
    res.status(500).json({ success: false, message: 'Error al asignar tarea' })
  }
}

// DELETE /api/tareas/:id
export const deleteTarea = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const existing: any = await query('SELECT id FROM tareas WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Tarea no encontrada' })
    }

    await query('UPDATE tareas SET deleted_at = NOW() WHERE id = ?', [id])
    res.json({ success: true, message: 'Tarea eliminada correctamente' })
  } catch (error) {
    console.error('Error al eliminar tarea:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar tarea' })
  }
}

// GET /api/tareas/:id/comentarios
export const getComentarios = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result = await query(
      `SELECT c.id, c.contenido, c.created_at, c.usuario_id, u.nombre AS usuario_nombre
       FROM tareas_comentarios c
       JOIN usuarios u ON c.usuario_id = u.id
       WHERE c.tarea_id = ? AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC`,
      [id],
    )
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener comentarios:', error)
    res.status(500).json({ success: false, message: 'Error al obtener comentarios' })
  }
}

// POST /api/tareas/:id/comentarios
export const createComentario = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { contenido, usuario_id } = req.body

    if (!contenido?.trim() || !usuario_id) {
      return res.status(400).json({ success: false, message: 'Contenido y usuario son requeridos' })
    }

    const tareaExists: any = await query('SELECT id FROM tareas WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(tareaExists) || tareaExists.length === 0) {
      return res.status(404).json({ success: false, message: 'Tarea no encontrada' })
    }

    const result: any = await query(
      `INSERT INTO tareas_comentarios (tarea_id, usuario_id, contenido) VALUES (?, ?, ?)`,
      [id, usuario_id, contenido.trim()],
    )

    const newComment: any = await query(
      `SELECT c.id, c.contenido, c.created_at, c.usuario_id, u.nombre AS usuario_nombre
       FROM tareas_comentarios c
       JOIN usuarios u ON c.usuario_id = u.id
       WHERE c.id = ?`,
      [result.insertId],
    )

    res.status(201).json({ success: true, data: newComment[0] })
  } catch (error) {
    console.error('Error al crear comentario:', error)
    res.status(500).json({ success: false, message: 'Error al crear comentario' })
  }
}

// DELETE /api/tareas/:id/comentarios/:comentarioId
export const deleteComentario = async (req: Request, res: Response) => {
  try {
    const { comentarioId } = req.params
    await query(`UPDATE tareas_comentarios SET deleted_at = NOW() WHERE id = ?`, [comentarioId])
    res.json({ success: true })
  } catch (error) {
    console.error('Error al eliminar comentario:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar comentario' })
  }
}
