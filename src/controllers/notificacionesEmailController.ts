import type { Request, Response } from 'express'
import { query } from '../config/database'
import {
  TIPOS_VALIDOS,
  buildContexto,
  buildEmail,
  sendNotificacionEmail,
  type NotificacionTipo,
} from '../services/notificacionesEmailService'

interface UsuarioRow {
  id: number
  nombre: string
  email: string | null
}

interface DestinatarioPayload {
  id: number
  nombre: string
  email: string
  sugerido: boolean
  motivo_sugerido?: string
}

function isTipoValido(value: unknown): value is NotificacionTipo {
  return typeof value === 'string' && (TIPOS_VALIDOS as string[]).includes(value)
}

async function getUsuariosConEmail(): Promise<UsuarioRow[]> {
  const rows = (await query(
    `SELECT id, nombre, email
     FROM usuarios
     WHERE activo = 1 AND deleted_at IS NULL AND email IS NOT NULL AND email <> ''
     ORDER BY nombre ASC`,
  )) as UsuarioRow[]
  return rows
}

async function getUsuariosConPermisoEnSucursal(permisoClave: string, sucursalId: number | null): Promise<Set<number>> {
  const rows = (await query(
    `SELECT DISTINCT u.id
     FROM usuarios u
     INNER JOIN roles r ON r.id = u.rol_id
     INNER JOIN roles_permisos rp ON rp.rol_id = r.id
     INNER JOIN permisos p ON p.id = rp.permiso_id
     LEFT JOIN usuarios_sucursales us ON us.usuario_id = u.id
     WHERE u.activo = 1 AND u.deleted_at IS NULL
       AND p.clave = ?
       AND (r.nombre = 'superadmin' OR us.sucursal_id ${sucursalId == null ? 'IS NOT NULL' : '= ?'})`,
    sucursalId == null ? [permisoClave] : [permisoClave, sucursalId],
  )) as Array<{ id: number }>
  return new Set(rows.map(r => Number(r.id)))
}

async function buildSugeridos(
  tipo: NotificacionTipo,
  entidadId: number,
  sucursalId: number | null,
  actorUserId: number | null,
  creadorUserId: number | null,
): Promise<Map<number, string>> {
  const sugeridos = new Map<number, string>()

  if (tipo === 'solicitud_rrhh_creada' || tipo === 'pago_pendiente_creado') {
    const permiso = tipo === 'solicitud_rrhh_creada' ? 'aprobar_solicitudes' : 'aprobar_pendientes'
    const ids = await getUsuariosConPermisoEnSucursal(permiso, sucursalId)
    const motivo = 'Puede aprobar este tipo de pedidos'
    for (const id of ids) sugeridos.set(id, motivo)
  } else {
    if (creadorUserId) sugeridos.set(creadorUserId, 'Creó el pedido')
  }

  if (actorUserId) sugeridos.delete(actorUserId)
  void entidadId
  return sugeridos
}

// GET /api/notificaciones/email/destinatarios?tipo=X&entidad_id=Y
export const getDestinatariosSugeridos = async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ success: false, message: 'Usuario no autenticado' })

    const { tipo, entidad_id } = req.query
    if (!isTipoValido(tipo)) {
      return res.status(400).json({ success: false, message: 'Tipo de notificación inválido' })
    }
    const entidadId = Number(entidad_id)
    if (!Number.isFinite(entidadId) || entidadId <= 0) {
      return res.status(400).json({ success: false, message: 'entidad_id inválido' })
    }

    const contexto = await buildContexto(tipo, entidadId)
    if (!contexto) {
      return res.status(404).json({ success: false, message: 'Entidad no encontrada' })
    }

    const creadorUserId = contexto.kind === 'solicitud' ? contexto.solicitud.usuario_id : contexto.pago.user_id

    const [usuarios, sugeridosMap] = await Promise.all([
      getUsuariosConEmail(),
      buildSugeridos(tipo, entidadId, contexto.sucursalId, user.id, creadorUserId),
    ])

    const destinatarios: DestinatarioPayload[] = usuarios
      .filter(u => u.id !== user.id && u.email)
      .map(u => {
        const motivo = sugeridosMap.get(u.id)
        return {
          id: u.id,
          nombre: u.nombre,
          email: u.email as string,
          sugerido: !!motivo,
          ...(motivo ? { motivo_sugerido: motivo } : {}),
        }
      })

    return res.json({
      success: true,
      data: {
        contexto: {
          titulo: contexto.titulo,
          resumen: contexto.resumen,
          tipoLabel: contexto.tipoLabel,
        },
        destinatarios,
      },
    })
  } catch (error) {
    console.error('Error al obtener destinatarios de notificación:', error)
    return res.status(500).json({ success: false, message: 'Error al obtener destinatarios' })
  }
}

// POST /api/notificaciones/email/enviar
// body: { tipo, entidad_id, destinatarios_usuario_ids: number[], mensaje_extra?: string }
export const enviarNotificacionEmail = async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ success: false, message: 'Usuario no autenticado' })

    const { tipo, entidad_id, destinatarios_usuario_ids, mensaje_extra } = req.body as {
      tipo?: unknown
      entidad_id?: unknown
      destinatarios_usuario_ids?: unknown
      mensaje_extra?: unknown
    }

    if (!isTipoValido(tipo)) {
      return res.status(400).json({ success: false, message: 'Tipo de notificación inválido' })
    }
    const entidadId = Number(entidad_id)
    if (!Number.isFinite(entidadId) || entidadId <= 0) {
      return res.status(400).json({ success: false, message: 'entidad_id inválido' })
    }
    if (!Array.isArray(destinatarios_usuario_ids) || destinatarios_usuario_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Debes seleccionar al menos un destinatario' })
    }
    const ids = destinatarios_usuario_ids.map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0 && v !== user.id)
    if (ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Destinatarios inválidos' })
    }

    const contexto = await buildContexto(tipo, entidadId)
    if (!contexto) {
      return res.status(404).json({ success: false, message: 'Entidad no encontrada' })
    }

    const placeholders = ids.map(() => '?').join(',')
    const usuarios = (await query(
      `SELECT id, nombre, email FROM usuarios
       WHERE id IN (${placeholders}) AND activo = 1 AND deleted_at IS NULL
         AND email IS NOT NULL AND email <> ''`,
      ids,
    )) as UsuarioRow[]
    const emails = usuarios.map(u => u.email as string)

    if (emails.length === 0) {
      return res.status(400).json({ success: false, message: 'Ningún destinatario tiene email válido' })
    }

    const remitenteRow = (await query(`SELECT nombre FROM usuarios WHERE id = ?`, [user.id])) as Array<{
      nombre: string
    }>
    const remitenteNombre = remitenteRow[0]?.nombre ?? 'Usuario de Heroica'
    const mensaje = typeof mensaje_extra === 'string' && mensaje_extra.trim() ? mensaje_extra.trim() : null

    const { subject, html } = buildEmail(contexto, tipo, mensaje, remitenteNombre)
    const result = await sendNotificacionEmail(emails, subject, html)

    if (result.error) {
      return res.status(502).json({ success: false, message: `Error al enviar email: ${result.error}` })
    }

    return res.json({
      success: true,
      data: { enviados: result.enviados, destinatarios: usuarios.map(u => ({ id: u.id, nombre: u.nombre })) },
    })
  } catch (error) {
    console.error('Error al enviar notificación email:', error)
    return res.status(500).json({ success: false, message: 'Error al enviar la notificación' })
  }
}
