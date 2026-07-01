import { Request, Response } from 'express'
import { query } from '../config/database'

const FIELDS = `
  p.id,
  p.nombre,
  p.area_id,
  a.nombre AS area_nombre,
  p.created_at,
  p.updated_at
`

// GET /api/puestos?area_id=X (area_id opcional — sin él devuelve todos)
export const getPuestos = async (req: Request, res: Response) => {
  try {
    const { area_id } = req.query
    const params: any[] = []
    let whereArea = ''

    if (area_id) {
      whereArea = 'AND p.area_id = ?'
      params.push(area_id)
    }

    const result = await query(
      `SELECT ${FIELDS}
       FROM puestos p
       LEFT JOIN areas a ON a.id = p.area_id
       WHERE p.deleted_at IS NULL ${whereArea}
       ORDER BY a.nombre ASC, p.nombre ASC`,
      params,
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
    const { nombre, area_id } = req.body

    if (!nombre?.trim() || !area_id) {
      return res.status(400).json({ success: false, message: 'nombre y area_id son requeridos' })
    }

    const areaExists: any = await query(
      'SELECT id FROM areas WHERE id = ? AND deleted_at IS NULL',
      [area_id],
    )

    if (!areaExists.length) {
      return res.status(404).json({ success: false, message: 'El área especificada no existe' })
    }

    const result: any = await query(
      'INSERT INTO puestos (nombre, area_id) VALUES (?, ?)',
      [nombre.trim(), area_id],
    )

    const created: any = await query(
      `SELECT ${FIELDS} FROM puestos p LEFT JOIN areas a ON a.id = p.area_id WHERE p.id = ?`,
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
    const { nombre, area_id } = req.body

    if (!nombre?.trim() || !area_id) {
      return res.status(400).json({ success: false, message: 'nombre y area_id son requeridos' })
    }

    const existing: any = await query(
      'SELECT id FROM puestos WHERE id = ? AND deleted_at IS NULL',
      [id],
    )

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Puesto no encontrado' })
    }

    const areaExists: any = await query(
      'SELECT id FROM areas WHERE id = ? AND deleted_at IS NULL',
      [area_id],
    )

    if (!areaExists.length) {
      return res.status(404).json({ success: false, message: 'El área especificada no existe' })
    }

    await query('UPDATE puestos SET nombre = ?, area_id = ? WHERE id = ?', [nombre.trim(), area_id, id])

    const updated: any = await query(
      `SELECT ${FIELDS} FROM puestos p LEFT JOIN areas a ON a.id = p.area_id WHERE p.id = ?`,
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
