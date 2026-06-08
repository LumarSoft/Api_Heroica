import { Request, Response } from 'express'
import { query } from '../config/database'

const FIELDS = `
  e.id, e.sucursal_id,
  e.puesto_id,
  p.nombre AS puesto_nombre,
  p.area_id,
  a.nombre AS area_nombre,
  e.sueldo_base, e.mes, e.anio, e.valor_hora, e.updated_at
`

// GET /api/escalas-salariales?sucursal_id=X  (opcional: &puesto_id=Y)
export const getEscalas = async (req: Request, res: Response) => {
  try {
    const { sucursal_id, puesto_id } = req.query

    if (!sucursal_id) {
      return res.status(400).json({ success: false, message: 'sucursal_id es requerido' })
    }

    const params: unknown[] = [sucursal_id]
    let whereExtra = ''

    if (puesto_id) {
      whereExtra = 'AND e.puesto_id = ?'
      params.push(puesto_id)
    }

    const result = await query(
      `SELECT ${FIELDS}
       FROM escalas_salariales e
       LEFT JOIN puestos p ON p.id = e.puesto_id
       LEFT JOIN areas a ON a.id = p.area_id
       WHERE e.deleted_at IS NULL AND e.sucursal_id = ? ${whereExtra}
       ORDER BY a.nombre ASC, p.nombre ASC, e.anio ASC, e.mes ASC`,
      params,
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
    const { sucursal_id, puesto_id, sueldo_base, mes, anio, valor_hora } = req.body

    if (!sucursal_id || !puesto_id || sueldo_base === undefined || !mes || !anio) {
      return res
        .status(400)
        .json({ success: false, message: 'sucursal_id, puesto_id, sueldo_base, mes y anio son requeridos' })
    }

    const result: any = await query(
      'INSERT INTO escalas_salariales (sucursal_id, puesto_id, sueldo_base, mes, anio, valor_hora) VALUES (?, ?, ?, ?, ?, ?)',
      [sucursal_id, puesto_id, sueldo_base, mes, anio, valor_hora ?? null],
    )

    const created: any = await query(
      `SELECT ${FIELDS} FROM escalas_salariales e
       LEFT JOIN puestos p ON p.id = e.puesto_id
       LEFT JOIN areas a ON a.id = p.area_id
       WHERE e.id = ?`,
      [result.insertId],
    )

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
    const { puesto_id, sueldo_base, mes, anio, valor_hora } = req.body

    if (!puesto_id || sueldo_base === undefined || !mes || !anio) {
      return res.status(400).json({ success: false, message: 'puesto_id, sueldo_base, mes y anio son requeridos' })
    }

    const existing: any = await query('SELECT id FROM escalas_salariales WHERE id = ? AND deleted_at IS NULL', [id])

    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Escala salarial no encontrada' })
    }

    await query(
      'UPDATE escalas_salariales SET puesto_id = ?, sueldo_base = ?, mes = ?, anio = ?, valor_hora = ? WHERE id = ?',
      [puesto_id, sueldo_base, mes, anio, valor_hora ?? null, id],
    )

    const updated: any = await query(
      `SELECT ${FIELDS} FROM escalas_salariales e
       LEFT JOIN puestos p ON p.id = e.puesto_id
       LEFT JOIN areas a ON a.id = p.area_id
       WHERE e.id = ?`,
      [id],
    )

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

// POST /api/escalas-salariales/copiar
// Body: { origen_sucursal_id, mes, anio, destino_sucursal_ids: number[] }
// Copia todas las escalas del período indicado desde la sucursal origen a las destino.
// Hace UPSERT: si ya existe (mismo sucursal+puesto+mes+anio activo), la sobreescribe.
export const copiarEscalas = async (req: Request, res: Response) => {
  try {
    const { origen_sucursal_id, mes, anio, destino_sucursal_ids } = req.body

    if (
      !origen_sucursal_id ||
      !mes ||
      !anio ||
      !Array.isArray(destino_sucursal_ids) ||
      destino_sucursal_ids.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'origen_sucursal_id, mes, anio y destino_sucursal_ids (array) son requeridos',
      })
    }

    const origen = (await query(
      `SELECT puesto_id, sueldo_base, valor_hora
       FROM escalas_salariales
       WHERE sucursal_id = ? AND mes = ? AND anio = ? AND deleted_at IS NULL`,
      [origen_sucursal_id, mes, anio],
    )) as any[]

    if (origen.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No hay escalas en la sucursal origen para el período indicado',
      })
    }

    let copiadas = 0

    for (const destId of destino_sucursal_ids) {
      if (Number(destId) === Number(origen_sucursal_id)) continue

      for (const escala of origen) {
        // Soft-delete existing active entry for same sucursal+puesto+mes+anio
        await query(
          `UPDATE escalas_salariales
           SET deleted_at = NOW()
           WHERE sucursal_id = ? AND puesto_id = ? AND mes = ? AND anio = ? AND deleted_at IS NULL`,
          [destId, escala.puesto_id, mes, anio],
        )

        await query(
          `INSERT INTO escalas_salariales (sucursal_id, puesto_id, sueldo_base, mes, anio, valor_hora)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [destId, escala.puesto_id, escala.sueldo_base, mes, anio, escala.valor_hora],
        )

        copiadas++
      }
    }

    res.json({
      success: true,
      message: `${copiadas} escala${copiadas !== 1 ? 's' : ''} copiada${copiadas !== 1 ? 's' : ''} correctamente`,
      data: { copiadas },
    })
  } catch (error) {
    console.error('Error al copiar escalas salariales:', error)
    res.status(500).json({ success: false, message: 'Error al copiar escalas salariales' })
  }
}
