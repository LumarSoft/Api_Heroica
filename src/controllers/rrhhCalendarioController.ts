import { Request, Response } from 'express'
import { query } from '../config/database'

const EVENTOS_VALIDOS = ['Capacitación', 'Reunión', 'Comunicado', 'Vencimiento', 'Evento interno', 'Otro']
const TIPOS_NOTION_VALIDOS = ['General', 'Invitación', 'Comunicado', 'Recordatorio']

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeHora(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  return /^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
}

function normalizePayload(body: Record<string, unknown>) {
  const evento = typeof body.evento === 'string' ? body.evento.trim() : ''
  const tipoNotion = typeof body.tipo_notion === 'string' ? body.tipo_notion.trim() : 'General'

  return {
    evento,
    fecha: body.fecha,
    hora: normalizeHora(body.hora),
    direccion: normalizeOptionalText(body.direccion),
    participantes: normalizeOptionalText(body.participantes),
    comentarios: normalizeOptionalText(body.comentarios),
    tipo_notion: tipoNotion,
  }
}

function validatePayload(payload: ReturnType<typeof normalizePayload>): string | null {
  if (!payload.evento || !EVENTOS_VALIDOS.includes(payload.evento)) return 'Evento inválido'
  if (!isValidDate(payload.fecha)) return 'Fecha inválida'
  if (payload.hora && !/^\d{2}:\d{2}(:\d{2})?$/.test(payload.hora)) return 'Hora inválida'
  if (!TIPOS_NOTION_VALIDOS.includes(payload.tipo_notion)) return 'Tipo Notion inválido'
  return null
}

const selectEventosSql = `
  SELECT e.id, e.evento, DATE_FORMAT(e.fecha, '%Y-%m-%d') AS fecha, TIME_FORMAT(e.hora, '%H:%i') AS hora,
         e.direccion, e.participantes, e.comentarios, e.tipo_notion, e.creado_por,
         u.nombre AS creado_por_nombre, e.created_at, e.updated_at
  FROM rrhh_calendario_eventos e
  LEFT JOIN usuarios u ON e.creado_por = u.id
`

// GET /api/rrhh/calendario
export const getEventosCalendario = async (req: Request, res: Response) => {
  try {
    const { desde, hasta } = req.query
    const conditions = ['e.deleted_at IS NULL']
    const params: string[] = []

    if (isValidDate(desde)) {
      conditions.push('e.fecha >= ?')
      params.push(desde)
    }

    if (isValidDate(hasta)) {
      conditions.push('e.fecha <= ?')
      params.push(hasta)
    }

    const result = await query(
      `${selectEventosSql}
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.fecha ASC, e.hora IS NULL ASC, e.hora ASC, e.created_at DESC`,
      params,
    )

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Error al obtener eventos de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al obtener eventos del calendario' })
  }
}

// POST /api/rrhh/calendario
export const createEventoCalendario = async (req: Request, res: Response) => {
  try {
    const payload = normalizePayload(req.body)
    const validationError = validatePayload(payload)
    if (validationError) return res.status(400).json({ success: false, message: validationError })

    const result: any = await query(
      `INSERT INTO rrhh_calendario_eventos
       (evento, fecha, hora, direccion, participantes, comentarios, tipo_notion, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.evento,
        payload.fecha,
        payload.hora,
        payload.direccion,
        payload.participantes,
        payload.comentarios,
        payload.tipo_notion,
        req.user?.id ?? null,
      ],
    )

    const created: any = await query(`${selectEventosSql} WHERE e.id = ? AND e.deleted_at IS NULL`, [result.insertId])
    res.status(201).json({ success: true, data: created[0] })
  } catch (error) {
    console.error('Error al crear evento de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al crear evento del calendario' })
  }
}

// PUT /api/rrhh/calendario/:id
export const updateEventoCalendario = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const payload = normalizePayload(req.body)
    const validationError = validatePayload(payload)
    if (validationError) return res.status(400).json({ success: false, message: validationError })

    const existing: any = await query('SELECT id FROM rrhh_calendario_eventos WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Evento no encontrado' })
    }

    await query(
      `UPDATE rrhh_calendario_eventos
       SET evento = ?, fecha = ?, hora = ?, direccion = ?, participantes = ?, comentarios = ?, tipo_notion = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        payload.evento,
        payload.fecha,
        payload.hora,
        payload.direccion,
        payload.participantes,
        payload.comentarios,
        payload.tipo_notion,
        id,
      ],
    )

    const updated: any = await query(`${selectEventosSql} WHERE e.id = ? AND e.deleted_at IS NULL`, [id])
    res.json({ success: true, data: updated[0] })
  } catch (error) {
    console.error('Error al actualizar evento de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar evento del calendario' })
  }
}

// DELETE /api/rrhh/calendario/:id
export const deleteEventoCalendario = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const existing: any = await query('SELECT id FROM rrhh_calendario_eventos WHERE id = ? AND deleted_at IS NULL', [id])
    if (!Array.isArray(existing) || existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Evento no encontrado' })
    }

    await query('UPDATE rrhh_calendario_eventos SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id])
    res.json({ success: true, message: 'Evento eliminado correctamente' })
  } catch (error) {
    console.error('Error al eliminar evento de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar evento del calendario' })
  }
}
