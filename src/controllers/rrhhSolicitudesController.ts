import { Request, Response } from 'express'
import { query } from '../config/database'

const TIPOS_VALIDOS = [
  'Altas',
  'Bajas',
  'Novedades de sueldo',
  'Incentivos y premios',
  'Licencias',
  'Vacaciones',
  'Suspensiones',
  'Apercibimientos',
  'Capacitaciones',
  'Pedido de uniforme',
  'Adelantos',
]
const ESTADOS_VALIDOS = ['Pendiente', 'Aprobada', 'Rechazada', 'Cancelada']

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

export const getSolicitudes = async (req: Request, res: Response) => {
  try {
    const { sucursal_id, personal_id, tipo, estado } = req.query
    const conditions = ['s.deleted_at IS NULL']
    const params: Array<string | number> = []

    if (sucursal_id) {
      conditions.push('s.sucursal_id = ?')
      params.push(Number(sucursal_id))
    }

    if (personal_id) {
      conditions.push('s.personal_id = ?')
      params.push(Number(personal_id))
    }

    if (tipo && TIPOS_VALIDOS.includes(tipo as string)) {
      conditions.push('s.tipo = ?')
      params.push(tipo as string)
    }

    if (estado && ESTADOS_VALIDOS.includes(estado as string)) {
      conditions.push('s.estado = ?')
      params.push(estado as string)
    }

    const selectSql = `
      SELECT s.*, 
             suc.nombre AS sucursal_nombre,
             p.nombre AS personal_nombre, p.legajo, p.dni,
             u.nombre AS usuario_nombre
      FROM rrhh_solicitudes s
      INNER JOIN sucursales suc ON s.sucursal_id = suc.id
      LEFT JOIN personal p ON s.personal_id = p.id
      INNER JOIN usuarios u ON s.usuario_id = u.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.fecha_solicitud DESC, s.created_at DESC
    `
    const result = await query(selectSql, params)

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener solicitudes de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al obtener solicitudes' })
  }
}

export const createSolicitud = async (req: Request, res: Response) => {
  try {
    const { sucursal_id, personal_id, tipo, fecha_solicitud, detalles, observaciones } = req.body

    const usuario_id = req.user?.id
    if (!usuario_id) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const normalizedSucursalId = normalizeNumber(sucursal_id)
    if (!normalizedSucursalId) return res.status(400).json({ success: false, message: 'Sucursal requerida' })

    if (!tipo || !TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ success: false, message: 'Tipo de solicitud inválido' })

    const normalizedPersonalId = normalizeNumber(personal_id)
    if (!fecha_solicitud) return res.status(400).json({ success: false, message: 'Fecha de solicitud requerida' })

    const jsonDetalles = detalles ? JSON.stringify(detalles) : null
    const normalizedObservaciones = normalizeOptionalText(observaciones)

    const result: any = await query(
      `INSERT INTO rrhh_solicitudes 
       (sucursal_id, personal_id, usuario_id, tipo, fecha_solicitud, detalles, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [normalizedSucursalId, normalizedPersonalId, usuario_id, tipo, fecha_solicitud, jsonDetalles, normalizedObservaciones],
    )

    const selectSql = `
      SELECT s.*, 
             suc.nombre AS sucursal_nombre,
             p.nombre AS personal_nombre, p.legajo, p.dni,
             u.nombre AS usuario_nombre
      FROM rrhh_solicitudes s
      INNER JOIN sucursales suc ON s.sucursal_id = suc.id
      LEFT JOIN personal p ON s.personal_id = p.id
      INNER JOIN usuarios u ON s.usuario_id = u.id
      WHERE s.id = ?
    `
    const created: any = await query(selectSql, [result.insertId])

    res.status(201).json({ success: true, data: created[0] })
  } catch (error) {
    console.error('Error al crear solicitud de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al crear solicitud' })
  }
}

export const updateEstadoSolicitud = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { estado } = req.body

    if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
      return res.status(400).json({ success: false, message: 'Estado inválido' })
    }

    const existing: any = await query('SELECT id FROM rrhh_solicitudes WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })
    }

    await query(
      `UPDATE rrhh_solicitudes
       SET estado = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [estado, id],
    )

    const selectSql = `
      SELECT s.*, 
             suc.nombre AS sucursal_nombre,
             p.nombre AS personal_nombre, p.legajo, p.dni,
             u.nombre AS usuario_nombre
      FROM rrhh_solicitudes s
      INNER JOIN sucursales suc ON s.sucursal_id = suc.id
      LEFT JOIN personal p ON s.personal_id = p.id
      INNER JOIN usuarios u ON s.usuario_id = u.id
      WHERE s.id = ?
    `
    const updated: any = await query(selectSql, [id])
    
    res.json({ success: true, data: updated[0] })
  } catch (error) {
    console.error('Error al actualizar estado de la solicitud de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar estado de la solicitud' })
  }
}

export const deleteSolicitud = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const existing: any = await query('SELECT id FROM rrhh_solicitudes WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })
    }

    await query('UPDATE rrhh_solicitudes SET deleted_at = NOW() WHERE id = ?', [id])

    res.json({ success: true, message: 'Solicitud eliminada' })
  } catch (error) {
    console.error('Error al eliminar solicitud de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar solicitud' })
  }
}
