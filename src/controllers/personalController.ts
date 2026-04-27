import { Request, Response } from 'express'
import { getConnection, query } from '../config/database'

// GET /api/personal
export const getPersonal = async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, legajo, nombre, dni, puesto, fecha_incorporacion, carnet_manipulacion_alimentos, created_at, updated_at
       FROM personal
       WHERE deleted_at IS NULL
       ORDER BY legajo ASC`,
    )
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
      `SELECT id, legajo, nombre, dni, puesto, fecha_incorporacion, carnet_manipulacion_alimentos, created_at, updated_at
       FROM personal
       WHERE id = ? AND deleted_at IS NULL`,
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
    const { nombre, dni, puesto, fecha_incorporacion, carnet_manipulacion_alimentos } = req.body

    if (!nombre || !dni || !puesto || !fecha_incorporacion) {
      return res.status(400).json({ success: false, message: 'Nombre, DNI, puesto y fecha de incorporación son requeridos' })
    }

    connection = await getConnection()
    await connection.beginTransaction()

    // Verificar DNI duplicado (incluyendo soft-deleted para integridad)
    const [dniCheck]: any = await connection.execute(
      `SELECT id FROM personal WHERE dni = ?`,
      [dni],
    )
    if (Array.isArray(dniCheck) && dniCheck.length > 0) {
      await connection.rollback()
      return res.status(409).json({ success: false, message: 'Ya existe un colaborador con ese DNI' })
    }

    // Generar siguiente legajo (incluye borrados para mantener unicidad)
    const [lastRow]: any = await connection.execute(
      `SELECT MAX(CAST(legajo AS UNSIGNED)) AS max_num FROM personal`,
    )
    const maxNum =
      Array.isArray(lastRow) && lastRow.length > 0 && lastRow[0].max_num != null
        ? Number(lastRow[0].max_num)
        : 0
    const nuevoLegajo = String(maxNum + 1).padStart(6, '0')

    const [result]: any = await connection.execute(
      `INSERT INTO personal (legajo, nombre, dni, puesto, fecha_incorporacion, carnet_manipulacion_alimentos)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nuevoLegajo,
        nombre.trim(),
        dni.trim(),
        puesto.trim(),
        fecha_incorporacion,
        carnet_manipulacion_alimentos ? 1 : 0,
      ],
    )

    const [newRow]: any = await connection.execute(
      `SELECT id, legajo, nombre, dni, puesto, fecha_incorporacion, carnet_manipulacion_alimentos, created_at, updated_at
       FROM personal WHERE id = ?`,
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
    const { nombre, dni, puesto, fecha_incorporacion, carnet_manipulacion_alimentos } = req.body

    if (!nombre || !dni || !puesto || !fecha_incorporacion) {
      return res.status(400).json({ success: false, message: 'Nombre, DNI, puesto y fecha de incorporación son requeridos' })
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

    // Verificar DNI duplicado en otro registro
    const [dniCheck]: any = await connection.execute(
      `SELECT id FROM personal WHERE dni = ? AND id != ?`,
      [dni, id],
    )
    if (Array.isArray(dniCheck) && dniCheck.length > 0) {
      await connection.rollback()
      return res.status(409).json({ success: false, message: 'Ya existe un colaborador con ese DNI' })
    }

    await connection.execute(
      `UPDATE personal SET nombre = ?, dni = ?, puesto = ?, fecha_incorporacion = ?, carnet_manipulacion_alimentos = ?
       WHERE id = ?`,
      [nombre.trim(), dni.trim(), puesto.trim(), fecha_incorporacion, carnet_manipulacion_alimentos ? 1 : 0, id],
    )

    const [updated]: any = await connection.execute(
      `SELECT id, legajo, nombre, dni, puesto, fecha_incorporacion, carnet_manipulacion_alimentos, created_at, updated_at
       FROM personal WHERE id = ?`,
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
