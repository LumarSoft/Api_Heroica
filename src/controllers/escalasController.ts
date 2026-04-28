import { Request, Response } from 'express'
import { query } from '../config/database'

const FIELDS = 'id, puesto, sueldo_base, mes, anio, valor_hora'

// GET /api/escalas-salariales
export const getEscalas = async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT ${FIELDS} FROM escalas_salariales WHERE deleted_at IS NULL ORDER BY anio ASC, mes ASC`,
    )
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener escalas salariales:', error)
    res.status(500).json({ success: false, message: 'Error al obtener escalas salariales' })
  }
}

// POST /api/escalas-salariales
export const createEscala = async (req: Request, res: Response) => {
  try {
    const { puesto, sueldo_base, mes, anio, valor_hora } = req.body

    if (!puesto || sueldo_base === undefined || !mes || !anio) {
      return res.status(400).json({ success: false, message: 'puesto, sueldo_base, mes y anio son requeridos' })
    }

    const result: any = await query(
      'INSERT INTO escalas_salariales (puesto, sueldo_base, mes, anio, valor_hora) VALUES (?, ?, ?, ?, ?)',
      [puesto, sueldo_base, mes, anio, valor_hora ?? null],
    )

    const created: any = await query(`SELECT ${FIELDS} FROM escalas_salariales WHERE id = ?`, [result.insertId])

    res.status(201).json({ success: true, data: created[0] })
  } catch (error) {
    console.error('Error al crear escala salarial:', error)
    res.status(500).json({ success: false, message: 'Error al crear escala salarial' })
  }
}

// PUT /api/escalas-salariales/:id
export const updateEscala = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { puesto, sueldo_base, mes, anio, valor_hora } = req.body

    if (!puesto || sueldo_base === undefined || !mes || !anio) {
      return res.status(400).json({ success: false, message: 'puesto, sueldo_base, mes y anio son requeridos' })
    }

    const existing: any = await query('SELECT id FROM escalas_salariales WHERE id = ? AND deleted_at IS NULL', [id])

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Escala salarial no encontrada' })
    }

    await query(
      'UPDATE escalas_salariales SET puesto = ?, sueldo_base = ?, mes = ?, anio = ?, valor_hora = ? WHERE id = ?',
      [puesto, sueldo_base, mes, anio, valor_hora ?? null, id],
    )

    const updated: any = await query(`SELECT ${FIELDS} FROM escalas_salariales WHERE id = ?`, [id])

    res.json({ success: true, data: updated[0] })
  } catch (error) {
    console.error('Error al actualizar escala salarial:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar escala salarial' })
  }
}

// DELETE /api/escalas-salariales/:id
export const deleteEscala = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const existing: any = await query('SELECT id FROM escalas_salariales WHERE id = ? AND deleted_at IS NULL', [id])

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Escala salarial no encontrada' })
    }

    await query('UPDATE escalas_salariales SET deleted_at = NOW() WHERE id = ?', [id])

    res.json({ success: true, message: 'Escala salarial eliminada' })
  } catch (error) {
    console.error('Error al eliminar escala salarial:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar escala salarial' })
  }
}
