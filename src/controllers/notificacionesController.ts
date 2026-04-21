import { Request, Response } from 'express'
import { query } from '../config/database'
import { sendTareaNotificacionEmail } from '../services/emailService'

// POST /api/notificaciones
export const createNotificaciones = async (req: Request, res: Response) => {
  try {
    const { tarea_id, para_usuarios_ids, tipo, descripcion } = req.body
    const de_usuario_id = req.user!.id

    if (!tarea_id || !para_usuarios_ids?.length || !tipo || !descripcion) {
      return res.status(400).json({ success: false, message: 'Datos incompletos' })
    }

    const [tareaResult, remitenteResult]: any[] = await Promise.all([
      query('SELECT codigo, titulo FROM tareas WHERE id = ?', [tarea_id]),
      query('SELECT nombre FROM usuarios WHERE id = ?', [de_usuario_id]),
    ])

    const tarea = (tareaResult as any[])[0]
    const remitente = (remitenteResult as any[])[0]

    for (const uid of para_usuarios_ids) {
      await query(
        `INSERT INTO tareas_notificaciones (tarea_id, para_usuario_id, de_usuario_id, tipo, descripcion)
         VALUES (?, ?, ?, ?, ?)`,
        [tarea_id, uid, de_usuario_id, tipo, descripcion],
      )

      const destinatarioResult: any = await query(
        'SELECT nombre, email FROM usuarios WHERE id = ?',
        [uid],
      )
      const destinatario = (destinatarioResult as any[])[0]

      if (destinatario?.email && tarea) {
        sendTareaNotificacionEmail({
          destinatario: destinatario.email,
          destinatarioNombre: destinatario.nombre,
          remitente: remitente?.nombre ?? 'Sistema',
          tareaId: tarea.codigo,
          tareaTitulo: tarea.titulo,
          tipo,
          descripcion,
        })
      }
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error al crear notificaciones:', error)
    res.status(500).json({ success: false, message: 'Error al crear notificaciones' })
  }
}

// GET /api/notificaciones/mis
export const getMisNotificaciones = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id

    const result = await query(
      `SELECT n.id, n.tipo, n.descripcion, n.leida, n.created_at,
              n.tarea_id, t.codigo AS tarea_codigo, t.titulo AS tarea_titulo,
              u.nombre AS de_nombre
       FROM tareas_notificaciones n
       JOIN tareas t ON n.tarea_id = t.id
       JOIN usuarios u ON n.de_usuario_id = u.id
       WHERE n.para_usuario_id = ?
       ORDER BY n.created_at DESC
       LIMIT 60`,
      [userId],
    )

    const data = result as any[]
    const unreadCount = data.filter((n: any) => !n.leida).length

    res.json({ success: true, data, unreadCount })
  } catch (error) {
    console.error('Error al obtener notificaciones:', error)
    res.status(500).json({ success: false, message: 'Error al obtener notificaciones' })
  }
}

// PATCH /api/notificaciones/leer
export const marcarLeidas = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const { ids } = req.body

    if (ids && Array.isArray(ids) && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',')
      await query(
        `UPDATE tareas_notificaciones SET leida = 1 WHERE id IN (${placeholders}) AND para_usuario_id = ?`,
        [...ids, userId],
      )
    } else {
      await query(`UPDATE tareas_notificaciones SET leida = 1 WHERE para_usuario_id = ?`, [userId])
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error al marcar notificaciones:', error)
    res.status(500).json({ success: false, message: 'Error al marcar notificaciones' })
  }
}
