import { Request, Response } from 'express'
import { query } from '../config/database'

const FIELDS = 'id, nombre, sucursal_id, created_at, updated_at'

// GET /api/puestos?sucursal_id=X
export const getPuestos = async (req: Request, res: Response) => {
  try {
    const { sucursal_id } = req.query

    if (!sucursal_id) {
      return res.status(400).json({ success: false, message: 'sucursal_id es requerido' })
    }

    const result = await query(
      `SELECT ${FIELDS} FROM puestos WHERE sucursal_id = ? AND deleted_at IS NULL ORDER BY nombre ASC`,
      [sucursal_id],
    )

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener puestos:', error)
    res.status(500).json({ success: false, message: 'Error al obtener puestos' })
  }
}

// POST /api/puestos
export const createPuesto = async (req: Request, res: Response) => {
  try {
    const { nombre, sucursal_id } = req.body

    if (!nombre || !sucursal_id) {
      return res.status(400).json({ success: false, message: 'nombre y sucursal_id son requeridos' })
    }

    const result: any = await query(
      'INSERT INTO puestos (nombre, sucursal_id) VALUES (?, ?)',
      [nombre.trim(), sucursal_id],
    )

    const created: any = await query(
      `SELECT ${FIELDS} FROM puestos WHERE id = ?`,
      [result.insertId],
    )

    res.status(201).json({ success: true, data: created[0] })
  } catch (error) {
    console.error('Error al crear puesto:', error)
    res.status(500).json({ success: false, message: 'Error al crear puesto' })
  }
}

// PUT /api/puestos/:id
export const updatePuesto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { nombre } = req.body

    if (!nombre) {
      return res.status(400).json({ success: false, message: 'nombre es requerido' })
    }

    const existing: any = await query(
      'SELECT id FROM puestos WHERE id = ? AND deleted_at IS NULL',
      [id],
    )

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Puesto no encontrado' })
    }

    await query('UPDATE puestos SET nombre = ? WHERE id = ?', [nombre.trim(), id])

    const updated: any = await query(
      `SELECT ${FIELDS} FROM puestos WHERE id = ?`,
      [id],
    )

    res.json({ success: true, data: updated[0] })
  } catch (error) {
    console.error('Error al actualizar puesto:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar puesto' })
  }
}

// DELETE /api/puestos/:id
export const deletePuesto = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const existing: any = await query(
      'SELECT id FROM puestos WHERE id = ? AND deleted_at IS NULL',
      [id],
    )

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Puesto no encontrado' })
    }

    await query('UPDATE puestos SET deleted_at = NOW() WHERE id = ?', [id])

    res.json({ success: true, message: 'Puesto eliminado' })
  } catch (error) {
    console.error('Error al eliminar puesto:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar puesto' })
  }
}
