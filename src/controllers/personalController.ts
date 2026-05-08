import { Request, Response } from 'express'
import { getConnection, query } from '../config/database'

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function isValidEmail(value: string | null): boolean {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

const PERSONAL_PUBLIC_FIELDS = `p.id, p.legajo, p.nombre, p.dni, p.cuil, p.puesto_id, pu.nombre AS puesto_nombre,
              p.email, p.telefono, p.fecha_nacimiento, p.domicilio_real, p.domicilio_dni,
              p.sucursal_id, p.fecha_incorporacion, p.fecha_inicio_cobro,
              p.periodo_prueba, p.periodo_prueba_dias, p.jornada_semanal_dias, p.jornada_diaria_horas,
              p.propuesta_economica, p.beneficios, p.condicion_laboral, p.fecha_alta_temprana,
              p.banco, p.cbu, p.carnet_manipulacion_alimentos, p.carnet_archivo_url, p.carnet_archivo_nombre, p.carnet_vencimiento,
              p.solicitud_alta_id, p.activo, p.created_at, p.updated_at`

// GET /api/personal  —  ?sucursal_id=N filtra por sucursal
export const getPersonal = async (req: Request, res: Response) => {
  try {
    const sucursalId = req.query.sucursal_id ? Number(req.query.sucursal_id) : null

    const result = sucursalId
      ? await query(
          `SELECT ${PERSONAL_PUBLIC_FIELDS}
           FROM personal p
           LEFT JOIN puestos pu ON pu.id = p.puesto_id
           WHERE p.deleted_at IS NULL AND p.sucursal_id = ?
           ORDER BY p.legajo ASC`,
          [sucursalId],
        )
      : await query(
          `SELECT ${PERSONAL_PUBLIC_FIELDS}
           FROM personal p
           LEFT JOIN puestos pu ON pu.id = p.puesto_id
           WHERE p.deleted_at IS NULL
           ORDER BY p.legajo ASC`,
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
      `SELECT ${PERSONAL_PUBLIC_FIELDS}, p.datos_alta_json
       FROM personal p
       LEFT JOIN puestos pu ON pu.id = p.puesto_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
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
    const { nombre, dni, email, puesto_id, sucursal_id, fecha_incorporacion, periodo_prueba, periodo_prueba_dias, carnet_manipulacion_alimentos } = req.body
    const emailNormalizado = normalizeEmail(email)

    if (!nombre || !dni || !puesto_id || !sucursal_id || !fecha_incorporacion) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, DNI, puesto, sucursal y fecha de incorporación son requeridos',
      })
    }
    if (!isValidEmail(emailNormalizado)) {
      return res.status(400).json({ success: false, message: 'El email del colaborador no tiene un formato válido' })
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
      `INSERT INTO personal (legajo, nombre, dni, email, puesto_id, sucursal_id, fecha_incorporacion, periodo_prueba, periodo_prueba_dias, carnet_manipulacion_alimentos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nuevoLegajo,
        nombre.trim(),
        dni.trim(),
        emailNormalizado,
        puesto_id,
        sucursal_id,
        fecha_incorporacion,
        periodo_prueba ? 1 : 0,
        periodo_prueba ? Number(periodo_prueba_dias ?? 90) : null,
        carnet_manipulacion_alimentos ? 1 : 0,
      ],
    )

    const [newRow]: any = await connection.execute(
      `SELECT ${PERSONAL_PUBLIC_FIELDS}
       FROM personal p
       LEFT JOIN puestos pu ON pu.id = p.puesto_id
       WHERE p.id = ?`,
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
    const { nombre, dni, email, puesto_id, sucursal_id, fecha_incorporacion, periodo_prueba, periodo_prueba_dias, carnet_manipulacion_alimentos, activo } = req.body
    const emailNormalizado = normalizeEmail(email)

    if (!nombre || !dni || !puesto_id || !sucursal_id || !fecha_incorporacion) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, DNI, puesto, sucursal y fecha de incorporación son requeridos',
      })
    }
    if (!isValidEmail(emailNormalizado)) {
      return res.status(400).json({ success: false, message: 'El email del colaborador no tiene un formato válido' })
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
      `UPDATE personal
       SET nombre = ?, dni = ?, puesto_id = ?, sucursal_id = ?, fecha_incorporacion = ?,
           email = ?, periodo_prueba = ?, periodo_prueba_dias = ?, carnet_manipulacion_alimentos = ?, activo = ?
       WHERE id = ?`,
      [
        nombre.trim(),
        dni.trim(),
        puesto_id,
        sucursal_id,
        fecha_incorporacion,
        emailNormalizado,
        periodo_prueba ? 1 : 0,
        periodo_prueba ? Number(periodo_prueba_dias ?? 90) : null,
        carnet_manipulacion_alimentos ? 1 : 0,
        activo !== undefined ? (activo ? 1 : 0) : 1,
        id,
      ],
    )

    const [updated]: any = await connection.execute(
      `SELECT ${PERSONAL_PUBLIC_FIELDS}
       FROM personal p
       LEFT JOIN puestos pu ON pu.id = p.puesto_id
       WHERE p.id = ?`,
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
