import { Request, Response } from 'express'
import { getConnection, query } from '../config/database'

const SELECT_PERSONAL = `
  SELECT
    p.id, p.legajo, p.nombre, p.dni,
    p.puesto_id, pu.nombre AS puesto_nombre,
    p.sucursal_id,
    p.fecha_incorporacion,
    p.carnet_manipulacion_alimentos,
    p.activo,
    p.created_at, p.updated_at
  FROM personal p
  LEFT JOIN puestos pu ON p.puesto_id = pu.id AND pu.deleted_at IS NULL
`

// GET /api/personal?sucursal_id=X&puesto_id=Y&activo=1
export const getPersonal = async (req: Request, res: Response) => {
  try {
    const { sucursal_id, puesto_id, activo } = req.query
    const conditions: string[] = ['p.deleted_at IS NULL']
    const params: unknown[] = []

    if (sucursal_id) {
      conditions.push('p.sucursal_id = ?')
      params.push(Number(sucursal_id))
    }

    if (puesto_id) {
      conditions.push('p.puesto_id = ?')
      params.push(Number(puesto_id))
    }

    if (activo !== undefined && activo !== '') {
      conditions.push('p.activo = ?')
      params.push(activo === '1' || activo === 'true' ? 1 : 0)
    }

    const sql = `${SELECT_PERSONAL} WHERE ${conditions.join(' AND ')} ORDER BY p.legajo ASC`
    const result = await query(sql, params)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener personal:', error)
    res.status(500).json({ success: false, message: 'Error al obtener personal' })
  }
}

// GET /api/personal/:id
export const getPersonalById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result: any = await query(
      `${SELECT_PERSONAL} WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    )
    if (!Array.isArray(result) || result.length === 0) {
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }
    res.json({ success: true, data: result[0] })
  } catch (error) {
    console.error('Error al obtener colaborador:', error)
    res.status(500).json({ success: false, message: 'Error al obtener colaborador' })
  }
}

// POST /api/personal
export const createPersonal = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null
  try {
    const { nombre, dni, puesto_id, sucursal_id, fecha_incorporacion, carnet_manipulacion_alimentos } = req.body

    if (!nombre || !dni || !puesto_id || !sucursal_id || !fecha_incorporacion) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, DNI, puesto, sucursal y fecha de incorporación son requeridos',
      })
    }

    connection = await getConnection()
    await connection.beginTransaction()

    const [dniCheck]: any = await connection.execute(
      `SELECT id FROM personal WHERE dni = ?`,
      [dni],
    )
    if (Array.isArray(dniCheck) && dniCheck.length > 0) {
      await connection.rollback()
      return res.status(409).json({ success: false, message: 'Ya existe un colaborador con ese DNI' })
    }

    const [lastRow]: any = await connection.execute(
      `SELECT MAX(CAST(legajo AS UNSIGNED)) AS max_num FROM personal`,
    )
    const maxNum =
      Array.isArray(lastRow) && lastRow.length > 0 && lastRow[0].max_num != null
        ? Number(lastRow[0].max_num)
        : 0
    const nuevoLegajo = String(maxNum + 1).padStart(6, '0')

    const [result]: any = await connection.execute(
      `INSERT INTO personal (legajo, nombre, dni, puesto_id, sucursal_id, fecha_incorporacion, carnet_manipulacion_alimentos)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nuevoLegajo,
        nombre.trim(),
        dni.trim(),
        Number(puesto_id),
        Number(sucursal_id),
        fecha_incorporacion,
        carnet_manipulacion_alimentos ? 1 : 0,
      ],
    )

    const [newRow]: any = await connection.execute(
      `${SELECT_PERSONAL} WHERE p.id = ?`,
      [result.insertId],
    )

    await connection.commit()
    res.status(201).json({ success: true, data: newRow[0] })
  } catch (error) {
    if (connection) await connection.rollback()
    console.error('Error al crear colaborador:', error)
    res.status(500).json({ success: false, message: 'Error al crear colaborador' })
  } finally {
    if (connection) connection.release()
  }
}

// PUT /api/personal/:id
export const updatePersonal = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null
  try {
    const { id } = req.params
    const { nombre, dni, puesto_id, fecha_incorporacion, carnet_manipulacion_alimentos, activo } = req.body

    if (!nombre || !dni || !puesto_id || !fecha_incorporacion) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, DNI, puesto y fecha de incorporación son requeridos',
      })
    }

    connection = await getConnection()
    await connection.beginTransaction()

    const [existing]: any = await connection.execute(
      `SELECT id FROM personal WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (!Array.isArray(existing) || existing.length === 0) {
      await connection.rollback()
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }

    const [dniCheck]: any = await connection.execute(
      `SELECT id FROM personal WHERE dni = ? AND id != ?`,
      [dni, id],
    )
    if (Array.isArray(dniCheck) && dniCheck.length > 0) {
      await connection.rollback()
      return res.status(409).json({ success: false, message: 'Ya existe un colaborador con ese DNI' })
    }

    await connection.execute(
      `UPDATE personal
       SET nombre = ?, dni = ?, puesto_id = ?, fecha_incorporacion = ?,
           carnet_manipulacion_alimentos = ?, activo = ?
       WHERE id = ?`,
      [
        nombre.trim(),
        dni.trim(),
        Number(puesto_id),
        fecha_incorporacion,
        carnet_manipulacion_alimentos ? 1 : 0,
        activo !== undefined ? (activo ? 1 : 0) : 1,
        id,
      ],
    )

    const [updated]: any = await connection.execute(
      `${SELECT_PERSONAL} WHERE p.id = ?`,
      [id],
    )

    await connection.commit()
    res.json({ success: true, data: updated[0] })
  } catch (error) {
    if (connection) await connection.rollback()
    console.error('Error al actualizar colaborador:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar colaborador' })
  } finally {
    if (connection) connection.release()
  }
}

// DELETE /api/personal/:id
export const deletePersonal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result: any = await query(
      `UPDATE personal SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [id],
    )
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }
    res.json({ success: true, message: 'Colaborador eliminado correctamente' })
  } catch (error) {
    console.error('Error al eliminar colaborador:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar colaborador' })
  }
}
