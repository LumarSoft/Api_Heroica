import type { Request, Response } from 'express'
import { getConnection, query } from '../config/database'
import { sendNuevaSolicitudEmail, sendSolicitudColaboradorEmail, sendSolicitudEventoEmail, sendSolicitudResueltaEmail } from '../services/rrhhSolicitudesEmailService'
import {
  ESTADOS_VALIDOS,
  SOLICITUD_SELECT,
  TIPOS_VALIDOS,
  enrichSolicitud,
  hasPermission,
  insertHistorial,
  normalizeNumber,
  normalizeOptionalText,
  parseDetalles,
  resolveSolicitudSideEffects,
  validateSolicitudContext,
  verificarAccesoSucursal,
  type SolicitudEstado,
  type SolicitudRow,
  type SolicitudTipo,
} from '../services/rrhhSolicitudesService'

async function getSolicitudRowById(id: number): Promise<SolicitudRow | null> {
  const rows = (await query(`${SOLICITUD_SELECT} WHERE s.id = ? AND s.deleted_at IS NULL`, [id])) as SolicitudRow[]
  return rows[0] ?? null
}

async function getSuperAdminEmails(): Promise<string[]> {
  const rows = (await query(
    `SELECT u.email
     FROM usuarios u
     INNER JOIN roles r ON r.id = u.rol_id
     WHERE r.nombre = 'superadmin' AND u.activo = 1 AND u.deleted_at IS NULL`,
  )) as Array<{ email: string }>

  return rows.map(row => row.email).filter(Boolean)
}

function uniqueEmails(emails: Array<string | null | undefined>): string[] {
  return [...new Set(emails.filter((email): email is string => Boolean(email)))]
}

async function getSucursalEmail(sucursalId: number): Promise<string | null> {
  const rows = (await query(
    `SELECT email_correspondencia FROM sucursales WHERE id = ? AND deleted_at IS NULL`,
    [sucursalId],
  )) as Array<{ email_correspondencia: string | null }>

  return rows[0]?.email_correspondencia ?? null
}

async function getResponsableEmails(sucursalId: number): Promise<string[]> {
  const [superAdminEmails, sucursalEmail] = await Promise.all([
    getSuperAdminEmails(),
    getSucursalEmail(sucursalId),
  ])

  return uniqueEmails([process.env.RRHH_RESPONSABLE_EMAIL, sucursalEmail, process.env.EMAIL_APROBACION, ...superAdminEmails])
}

async function getSeguimientoSolicitudEmails(solicitud: SolicitudRow): Promise<string[]> {
  const [responsables, solicitante] = await Promise.all([
    getResponsableEmails(solicitud.sucursal_id),
    getUserEmail(solicitud.usuario_id),
  ])

  return uniqueEmails([...responsables, solicitante?.email])
}

async function getUserEmail(userId: number): Promise<{ email: string; nombre: string } | null> {
  const rows = (await query(`SELECT email, nombre FROM usuarios WHERE id = ? AND activo = 1 AND deleted_at IS NULL`, [userId])) as Array<{
    email: string
    nombre: string
  }>

  return rows[0] ?? null
}

function getSolicitudColaboradorNombre(solicitud: SolicitudRow): string | null {
  if (solicitud.personal_nombre) return solicitud.personal_nombre
  const detalles = parseDetalles(solicitud.detalles)
  if (typeof detalles?.nombre === 'string' && detalles.nombre.trim()) return detalles.nombre.trim()
  return null
}

function getSolicitudColaboradorEmail(solicitud: SolicitudRow): string | null {
  if (solicitud.personal_email) return solicitud.personal_email
  const detalles = parseDetalles(solicitud.detalles)
  if (typeof detalles?.email === 'string' && detalles.email.trim()) return detalles.email.trim()
  return null
}

async function notifyColaborador(
  solicitud: SolicitudRow,
  estado: 'Creada' | 'Editada' | 'Aprobada' | 'Rechazada' | 'Cancelada' | 'Eliminada',
  motivoResolucion?: string | null,
): Promise<void> {
  const destinatario = getSolicitudColaboradorEmail(solicitud)
  const colaboradorNombre = getSolicitudColaboradorNombre(solicitud)
  if (!destinatario || !colaboradorNombre) return

  await sendSolicitudColaboradorEmail({
    destinatario,
    colaboradorNombre,
    estado,
    tipo: solicitud.tipo,
    sucursalNombre: solicitud.sucursal_nombre,
    solicitanteNombre: solicitud.usuario_nombre,
    revisorNombre: solicitud.resuelto_por_nombre,
    motivoResolucion,
  })
}

async function canViewGlobalSolicitudes(user: NonNullable<Request['user']>): Promise<boolean> {
  return (await hasPermission(user, 'ver_solicitudes_todas_sucursales')) || (await hasPermission(user, 'ver_historial_solicitudes_global'))
}

async function ensureSolicitudAccess(user: NonNullable<Request['user']>, solicitud: SolicitudRow): Promise<void> {
  const hasAccess = await verificarAccesoSucursal(user, solicitud.sucursal_id)
  if (!hasAccess) {
    throw new Error('NO_ACCESS')
  }
}

export const getSolicitudes = async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const { sucursal_id, personal_id, tipo, estado, fecha_desde, fecha_hasta } = req.query
    const conditions = ['s.deleted_at IS NULL']
    const params: Array<number | string> = []

    const normalizedSucursalId = normalizeNumber(sucursal_id)
    if (normalizedSucursalId) {
      const hasAccess = await verificarAccesoSucursal(user, normalizedSucursalId)
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
      }
      conditions.push('s.sucursal_id = ?')
      params.push(normalizedSucursalId)
    } else if (!(await canViewGlobalSolicitudes(user))) {
      conditions.push('EXISTS (SELECT 1 FROM usuarios_sucursales us WHERE us.usuario_id = ? AND us.sucursal_id = s.sucursal_id)')
      params.push(user.id)
    }

    const normalizedPersonalId = normalizeNumber(personal_id)
    if (normalizedPersonalId) {
      conditions.push('COALESCE(s.personal_creado_id, s.personal_id) = ?')
      params.push(normalizedPersonalId)
    }

    if (typeof tipo === 'string' && TIPOS_VALIDOS.includes(tipo as SolicitudTipo)) {
      conditions.push('s.tipo = ?')
      params.push(tipo)
    }

    if (typeof estado === 'string' && ESTADOS_VALIDOS.includes(estado as SolicitudEstado)) {
      conditions.push('s.estado = ?')
      params.push(estado)
    }

    if (typeof fecha_desde === 'string' && fecha_desde) {
      conditions.push('s.fecha_solicitud >= ?')
      params.push(fecha_desde)
    }

    if (typeof fecha_hasta === 'string' && fecha_hasta) {
      conditions.push('s.fecha_solicitud <= ?')
      params.push(fecha_hasta)
    }

    const rows = (await query(
      `${SOLICITUD_SELECT}
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE WHEN s.estado = 'Pendiente' THEN 0 ELSE 1 END, s.fecha_solicitud DESC, s.created_at DESC`,
      params,
    )) as SolicitudRow[]

    const enriched = await Promise.all(rows.map(enrichSolicitud))
    res.json({ success: true, data: enriched })
  } catch (error) {
    console.error('Error al obtener solicitudes de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al obtener solicitudes' })
  }
}

export const getSolicitudById = async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const solicitud = await getSolicitudRowById(Number(req.params.id))
    if (!solicitud) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })
    }

    await ensureSolicitudAccess(user, solicitud)
    res.json({ success: true, data: await enrichSolicitud(solicitud) })
  } catch (error) {
    if (error instanceof Error && error.message === 'NO_ACCESS') {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta solicitud' })
    }
    console.error('Error al obtener detalle de solicitud de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al obtener el detalle de la solicitud' })
  }
}

export const createSolicitud = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null

  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const { sucursal_id, personal_id, tipo, fecha_solicitud, detalles, observaciones } = req.body
    const normalizedSucursalId = normalizeNumber(sucursal_id)
    const normalizedPersonalId = normalizeNumber(personal_id)

    if (!normalizedSucursalId) {
      return res.status(400).json({ success: false, message: 'Sucursal requerida' })
    }

    const hasAccess = await verificarAccesoSucursal(user, normalizedSucursalId)
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    }

    if (!tipo || !TIPOS_VALIDOS.includes(tipo as SolicitudTipo)) {
      return res.status(400).json({ success: false, message: 'Tipo de solicitud inválido' })
    }

    if (!fecha_solicitud) {
      return res.status(400).json({ success: false, message: 'Fecha de solicitud requerida' })
    }

    connection = await getConnection()
    await connection.beginTransaction()

    const detallesNormalizados = await validateSolicitudContext(connection, {
      tipo: tipo as SolicitudTipo,
      sucursalId: normalizedSucursalId,
      personalId: normalizedPersonalId,
      detalles: parseDetalles(detalles),
    })

    const [insertResult] = await connection.execute(
      `INSERT INTO rrhh_solicitudes
       (sucursal_id, personal_id, usuario_id, tipo, fecha_solicitud, detalles, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedSucursalId,
        normalizedPersonalId,
        user.id,
        tipo,
        fecha_solicitud,
        detallesNormalizados ? JSON.stringify(detallesNormalizados) : null,
        normalizeOptionalText(observaciones),
      ],
    )

    const solicitudId = Number((insertResult as { insertId: number }).insertId)
    await insertHistorial(connection, solicitudId, normalizedPersonalId, user.id, 'Creada', 'Solicitud creada.')
    await connection.commit()
    connection.release()
    connection = null

    const created = await getSolicitudRowById(solicitudId)
    if (!created) {
      return res.status(404).json({ success: false, message: 'Solicitud creada no encontrada' })
    }

    await sendNuevaSolicitudEmail({
      destinatarios: await getResponsableEmails(created.sucursal_id),
      sucursalNombre: created.sucursal_nombre,
      tipo: created.tipo,
      solicitanteNombre: created.usuario_nombre,
      colaboradorNombre: getSolicitudColaboradorNombre(created),
      fechaSolicitud: created.fecha_solicitud,
    })
    await notifyColaborador(created, 'Creada')

    res.status(201).json({ success: true, data: await enrichSolicitud(created) })
  } catch (error) {
    if (connection) await connection.rollback()
    console.error('Error al crear solicitud de RRHH:', error)
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Error al crear solicitud' })
  } finally {
    if (connection) connection.release()
  }
}

export const updateSolicitud = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null

  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    connection = await getConnection()
    await connection.beginTransaction()

    const solicitudId = Number(req.params.id)
    const [rows] = await connection.execute<SolicitudRow[]>(
      `${SOLICITUD_SELECT} WHERE s.id = ? AND s.deleted_at IS NULL FOR UPDATE`,
      [solicitudId],
    )
    const solicitud = rows[0]

    if (!solicitud) {
      await connection.rollback()
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })
    }

    await ensureSolicitudAccess(user, solicitud)

    if (solicitud.estado !== 'Pendiente') {
      await connection.rollback()
      return res.status(409).json({ success: false, message: 'Solo se pueden editar solicitudes pendientes' })
    }

    const tipo = req.body.tipo as SolicitudTipo
    if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
      await connection.rollback()
      return res.status(400).json({ success: false, message: 'Tipo de solicitud inválido' })
    }

    const sucursalId = normalizeNumber(req.body.sucursal_id) ?? solicitud.sucursal_id
    const personalId = normalizeNumber(req.body.personal_id)

    if (!(await verificarAccesoSucursal(user, sucursalId))) {
      await connection.rollback()
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    }

    const detallesNormalizados = await validateSolicitudContext(connection, {
      tipo,
      sucursalId,
      personalId,
      detalles: parseDetalles(req.body.detalles),
      solicitudId,
    })

    await connection.execute(
      `UPDATE rrhh_solicitudes
       SET sucursal_id = ?, personal_id = ?, tipo = ?, fecha_solicitud = ?, detalles = ?, observaciones = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        sucursalId,
        personalId,
        tipo,
        req.body.fecha_solicitud,
        detallesNormalizados ? JSON.stringify(detallesNormalizados) : null,
        normalizeOptionalText(req.body.observaciones),
        solicitudId,
      ],
    )

    await insertHistorial(connection, solicitudId, personalId, user.id, 'Editada', 'Solicitud actualizada mientras seguía pendiente.')
    await connection.commit()
    connection.release()
    connection = null

    const updated = await getSolicitudRowById(solicitudId)
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Solicitud actualizada no encontrada' })
    }

    await sendSolicitudEventoEmail({
      destinatarios: await getSeguimientoSolicitudEmails(updated),
      titulo: 'Solicitud RRHH editada',
      descripcion: 'Se editó una solicitud pendiente de RRHH.',
      tipo: updated.tipo,
      sucursalNombre: updated.sucursal_nombre,
      solicitanteNombre: updated.usuario_nombre,
      colaboradorNombre: getSolicitudColaboradorNombre(updated),
      actorNombre: user.email,
      estado: updated.estado,
    })
    await notifyColaborador(updated, 'Editada')

    res.json({ success: true, data: await enrichSolicitud(updated) })
  } catch (error) {
    if (connection) await connection.rollback()
    if (error instanceof Error && error.message === 'NO_ACCESS') {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta solicitud' })
    }
    console.error('Error al editar solicitud de RRHH:', error)
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Error al editar solicitud' })
  } finally {
    if (connection) connection.release()
  }
}

export const updateEstadoSolicitud = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null

  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const solicitudId = Number(req.params.id)
    const nuevoEstado = req.body.estado as SolicitudEstado
    const motivoResolucion = normalizeOptionalText(req.body.motivo_resolucion)

    if (!nuevoEstado || !ESTADOS_VALIDOS.includes(nuevoEstado) || nuevoEstado === 'Pendiente') {
      return res.status(400).json({ success: false, message: 'Estado inválido' })
    }

    if (nuevoEstado === 'Rechazada' && !motivoResolucion) {
      return res.status(400).json({ success: false, message: 'El rechazo requiere un motivo' })
    }

    connection = await getConnection()
    await connection.beginTransaction()

    const [existingRows] = await connection.execute<SolicitudRow[]>(
      `${SOLICITUD_SELECT} WHERE s.id = ? AND s.deleted_at IS NULL FOR UPDATE`,
      [solicitudId],
    )
    const solicitud = existingRows[0]

    if (!solicitud) {
      await connection.rollback()
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })
    }

    await ensureSolicitudAccess(user, solicitud)

    if (solicitud.estado !== 'Pendiente') {
      await connection.rollback()
      return res.status(409).json({ success: false, message: 'La solicitud ya fue resuelta' })
    }

    let resolvedPersonalId = solicitud.personal_id
    let personalCreadoId = solicitud.personal_creado_id
    let liquidacionFinalEstado = solicitud.tipo === 'Bajas' ? 'Pendiente' : 'No aplica'

    if (nuevoEstado === 'Aprobada') {
      const effects = await resolveSolicitudSideEffects(connection, solicitud, user.id)
      resolvedPersonalId = effects.personalId
      personalCreadoId = effects.personalCreadoId
      liquidacionFinalEstado = effects.liquidacionFinalEstado
    }

    if (nuevoEstado === 'Rechazada') {
      liquidacionFinalEstado = solicitud.tipo === 'Bajas' ? 'Error' : 'No aplica'
    }

    await connection.execute(
      `UPDATE rrhh_solicitudes
       SET estado = ?, resuelto_por_usuario_id = ?, fecha_resolucion = NOW(), motivo_resolucion = ?,
           personal_id = ?, personal_creado_id = ?, liquidacion_final_estado = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [nuevoEstado, user.id, motivoResolucion, resolvedPersonalId, personalCreadoId, liquidacionFinalEstado, solicitudId],
    )

    await insertHistorial(
      connection,
      solicitudId,
      resolvedPersonalId,
      user.id,
      nuevoEstado === 'Aprobada' ? 'Aprobada' : 'Rechazada',
      nuevoEstado === 'Aprobada' ? 'Solicitud aprobada.' : motivoResolucion,
    )

    await connection.commit()
    connection.release()
    connection = null

    const updated = await getSolicitudRowById(solicitudId)
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Solicitud actualizada no encontrada' })
    }

    const creador = await getUserEmail(updated.usuario_id)
    if (creador && (nuevoEstado === 'Aprobada' || nuevoEstado === 'Rechazada')) {
      await sendSolicitudResueltaEmail({
        destinatario: creador.email,
        destinatarioNombre: creador.nombre,
        estado: nuevoEstado,
        tipo: updated.tipo,
        sucursalNombre: updated.sucursal_nombre,
        solicitanteNombre: updated.usuario_nombre,
        revisorNombre: updated.resuelto_por_nombre ?? 'Administrador',
        colaboradorNombre: updated.personal_nombre,
        motivoResolucion,
      })
    }

    await sendSolicitudEventoEmail({
      destinatarios: await getSeguimientoSolicitudEmails(updated),
      titulo: `Solicitud RRHH ${nuevoEstado.toLowerCase()}`,
      descripcion: `Se ${
        nuevoEstado === 'Aprobada' ? 'aprobó' : nuevoEstado === 'Rechazada' ? 'rechazó' : 'actualizó'
      } una solicitud de RRHH.`,
      tipo: updated.tipo,
      sucursalNombre: updated.sucursal_nombre,
      solicitanteNombre: updated.usuario_nombre,
      colaboradorNombre: getSolicitudColaboradorNombre(updated),
      actorNombre: updated.resuelto_por_nombre ?? 'Administrador',
      estado: nuevoEstado,
      motivo: motivoResolucion,
    })
    await notifyColaborador(updated, nuevoEstado, motivoResolucion)

    res.json({ success: true, data: await enrichSolicitud(updated) })
  } catch (error) {
    if (connection) await connection.rollback()
    if (error instanceof Error && error.message === 'NO_ACCESS') {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta solicitud' })
    }
    console.error('Error al actualizar estado de la solicitud de RRHH:', error)
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Error al actualizar la solicitud' })
  } finally {
    if (connection) connection.release()
  }
}

export const cancelSolicitud = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null

  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    connection = await getConnection()
    await connection.beginTransaction()

    const solicitudId = Number(req.params.id)
    const motivoCancelacion = normalizeOptionalText(req.body.motivo_resolucion) ?? 'Solicitud cancelada por el usuario.'
    const [rows] = await connection.execute<SolicitudRow[]>(
      `${SOLICITUD_SELECT} WHERE s.id = ? AND s.deleted_at IS NULL FOR UPDATE`,
      [solicitudId],
    )
    const solicitud = rows[0]

    if (!solicitud) {
      await connection.rollback()
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })
    }

    await ensureSolicitudAccess(user, solicitud)

    if (solicitud.estado !== 'Pendiente') {
      await connection.rollback()
      return res.status(409).json({ success: false, message: 'Solo se pueden cancelar solicitudes pendientes' })
    }

    await connection.execute(
      `UPDATE rrhh_solicitudes
       SET estado = 'Cancelada', resuelto_por_usuario_id = ?, fecha_resolucion = NOW(), motivo_resolucion = ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL`,
      [user.id, motivoCancelacion, solicitudId],
    )

    await insertHistorial(connection, solicitudId, solicitud.personal_id, user.id, 'Cancelada', motivoCancelacion)
    await connection.commit()
    connection.release()
    connection = null

    const updated = await getSolicitudRowById(solicitudId)
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Solicitud cancelada no encontrada' })
    }

    await sendSolicitudEventoEmail({
      destinatarios: await getSeguimientoSolicitudEmails(updated),
      titulo: 'Solicitud RRHH cancelada',
      descripcion: 'Se canceló una solicitud pendiente de RRHH.',
      tipo: updated.tipo,
      sucursalNombre: updated.sucursal_nombre,
      solicitanteNombre: updated.usuario_nombre,
      colaboradorNombre: getSolicitudColaboradorNombre(updated),
      actorNombre: user.email,
      estado: 'Cancelada',
      motivo: motivoCancelacion,
    })
    await notifyColaborador(updated, 'Cancelada', motivoCancelacion)

    res.json({ success: true, data: await enrichSolicitud(updated) })
  } catch (error) {
    if (connection) await connection.rollback()
    if (error instanceof Error && error.message === 'NO_ACCESS') {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta solicitud' })
    }
    console.error('Error al cancelar solicitud de RRHH:', error)
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Error al cancelar la solicitud' })
  } finally {
    if (connection) connection.release()
  }
}

export const deleteSolicitud = async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const solicitud = await getSolicitudRowById(Number(req.params.id))
    if (!solicitud) {
      return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })
    }

    await ensureSolicitudAccess(user, solicitud)

    if (solicitud.estado !== 'Pendiente') {
      return res.status(409).json({ success: false, message: 'Solo se pueden eliminar solicitudes pendientes' })
    }

    await query(`UPDATE rrhh_solicitudes SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`, [solicitud.id])
    await sendSolicitudEventoEmail({
      destinatarios: await getSeguimientoSolicitudEmails(solicitud),
      titulo: 'Solicitud RRHH eliminada',
      descripcion: 'Se eliminó una solicitud pendiente de RRHH.',
      tipo: solicitud.tipo,
      sucursalNombre: solicitud.sucursal_nombre,
      solicitanteNombre: solicitud.usuario_nombre,
      colaboradorNombre: getSolicitudColaboradorNombre(solicitud),
      actorNombre: user.email,
      estado: 'Eliminada',
    })
    await notifyColaborador(solicitud, 'Eliminada')
    res.json({ success: true, message: 'Solicitud eliminada' })
  } catch (error) {
    if (error instanceof Error && error.message === 'NO_ACCESS') {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta solicitud' })
    }
    console.error('Error al eliminar solicitud de RRHH:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar solicitud' })
  }
}
