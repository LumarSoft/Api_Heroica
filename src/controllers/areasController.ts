import { Request, Response } from 'express'
import { query } from '../config/database'

const FIELDS = 'id, nombre, descripcion, activo, created_at, updated_at'

// GET /api/areas
export const getAreas = async (req: Request, res: Response) => {
  try {
    const soloActivas = req.query.activo === '1'
    const whereActivo = soloActivas ? 'AND activo = 1' : ''

    const result = await query(
      `SELECT ${FIELDS} FROM areas WHERE deleted_at IS NULL ${whereActivo} ORDER BY nombre ASC`,
    )

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener áreas:', error)
    res.status(500).json({ success: false, message: 'Error al obtener áreas' })
  }
}

// POST /api/areas
export const createArea = async (req: Request, res: Response) => {
  try {
    const { nombre, descripcion } = req.body

    if (!nombre?.trim()) {
      return res.status(400).json({ success: false, message: 'nombre es requerido' })
    }

    const existing: any = await query(
      'SELECT id FROM areas WHERE nombre = ? AND deleted_at IS NULL',
      [nombre.trim()],
    )

    if (existing.length) {
      return res.status(409).json({ success: false, message: 'Ya existe un área con ese nombre' })
    }

    const result: any = await query(
      'INSERT INTO areas (nombre, descripcion) VALUES (?, ?)',
      [nombre.trim(), descripcion?.trim() ?? null],
    )

    const created: any = await query(`SELECT ${FIELDS} FROM areas WHERE id = ?`, [result.insertId])

    res.status(201).json({ success: true, data: created[0] })
  } catch (error) {
    console.error('Error al crear área:', error)
    res.status(500).json({ success: false, message: 'Error al crear área' })
  }
}

// PUT /api/areas/:id
export const updateArea = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { nombre, descripcion, activo } = req.body

    if (!nombre?.trim()) {
      return res.status(400).json({ success: false, message: 'nombre es requerido' })
    }

    const existing: any = await query(
      'SELECT id FROM areas WHERE id = ? AND deleted_at IS NULL',
      [id],
    )

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Área no encontrada' })
    }

    const duplicate: any = await query(
      'SELECT id FROM areas WHERE nombre = ? AND id != ? AND deleted_at IS NULL',
      [nombre.trim(), id],
    )

    if (duplicate.length) {
      return res.status(409).json({ success: false, message: 'Ya existe un área con ese nombre' })
    }

    await query(
      'UPDATE areas SET nombre = ?, descripcion = ?, activo = ? WHERE id = ?',
      [nombre.trim(), descripcion?.trim() ?? null, activo ?? 1, id],
    )

    const updated: any = await query(`SELECT ${FIELDS} FROM areas WHERE id = ?`, [id])

    res.json({ success: true, data: updated[0] })
  } catch (error) {
    console.error('Error al actualizar área:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar área' })
  }
}

// DELETE /api/areas/:id
export const deleteArea = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const existing: any = await query(
      'SELECT id FROM areas WHERE id = ? AND deleted_at IS NULL',
      [id],
    )

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Área no encontrada' })
    }

    const puestosAsociados: any = await query(
      'SELECT id FROM puestos WHERE area_id = ? AND deleted_at IS NULL LIMIT 1',
      [id],
    )

    if (puestosAsociados.length) {
      return res.status(409).json({
        success: false,
        message: 'No se puede eliminar el área porque tiene puestos asociados',
      })
    }

    await query('UPDATE areas SET deleted_at = NOW() WHERE id = ?', [id])

    res.json({ success: true, message: 'Área eliminada' })
  } catch (error) {
    console.error('Error al eliminar área:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar área' })
  }
}
