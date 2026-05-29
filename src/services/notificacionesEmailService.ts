import { Resend } from 'resend'
import { query } from '../config/database'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM ?? 'noreply@adminheroica.com'

export type NotificacionTipo =
  | 'solicitud_rrhh_creada'
  | 'solicitud_rrhh_aprobada'
  | 'solicitud_rrhh_rechazada'
  | 'pago_pendiente_creado'
  | 'pago_pendiente_aprobado'
  | 'pago_pendiente_rechazado'

export const TIPOS_VALIDOS: NotificacionTipo[] = [
  'solicitud_rrhh_creada',
  'solicitud_rrhh_aprobada',
  'solicitud_rrhh_rechazada',
  'pago_pendiente_creado',
  'pago_pendiente_aprobado',
  'pago_pendiente_rechazado',
]

interface SolicitudContexto {
  id: number
  tipo: string
  estado: string
  fecha_solicitud: string
  motivo_resolucion: string | null
  sucursal_id: number
  sucursal_nombre: string
  usuario_id: number
  solicitante_nombre: string
  resuelto_por_nombre: string | null
  colaborador_nombre: string | null
}

interface PagoContexto {
  id: number
  concepto: string
  monto: number
  moneda: string
  fecha: string
  prioridad: string | null
  estado: string
  motivo_rechazo: string | null
  sucursal_id: number
  sucursal_nombre: string
  user_id: number
  creador_nombre: string
  revisor_nombre: string | null
}

interface ContextoBase {
  tipoLabel: string
  titulo: string
  resumen: string
  sucursalId: number | null
  actorUserId: number | null
}

interface SolicitudContextoCompleto extends ContextoBase {
  kind: 'solicitud'
  solicitud: SolicitudContexto
}

interface PagoContextoCompleto extends ContextoBase {
  kind: 'pago'
  pago: PagoContexto
}

export type NotificacionContexto = SolicitudContextoCompleto | PagoContextoCompleto

function formatFecha(fecha: string | Date | null): string {
  if (!fecha) return '—'
  try {
    const d = typeof fecha === 'string' ? new Date(fecha) : fecha
    if (isNaN(d.getTime())) return String(fecha)
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return String(fecha)
  }
}

function formatMonto(monto: number, moneda: string): string {
  const abs = Math.abs(monto)
  const formatted = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs)
  return `${moneda} ${formatted}`
}

const TIPO_LABELS: Record<NotificacionTipo, string> = {
  solicitud_rrhh_creada: 'Nueva solicitud de RRHH',
  solicitud_rrhh_aprobada: 'Solicitud de RRHH aprobada',
  solicitud_rrhh_rechazada: 'Solicitud de RRHH rechazada',
  pago_pendiente_creado: 'Nuevo pago pendiente',
  pago_pendiente_aprobado: 'Pago aprobado',
  pago_pendiente_rechazado: 'Pago rechazado',
}

async function loadSolicitud(id: number): Promise<SolicitudContexto | null> {
  const rows = (await query(
    `SELECT s.id, s.tipo, s.estado, s.fecha_solicitud, s.motivo_resolucion, s.sucursal_id,
            su.nombre AS sucursal_nombre, s.usuario_id,
            uc.nombre AS solicitante_nombre,
            ur.nombre AS resuelto_por_nombre,
            p.nombre AS colaborador_nombre
     FROM rrhh_solicitudes s
     LEFT JOIN sucursales su ON su.id = s.sucursal_id
     LEFT JOIN usuarios uc ON uc.id = s.usuario_id
     LEFT JOIN usuarios ur ON ur.id = s.resuelto_por_usuario_id
     LEFT JOIN personal p ON p.id = s.personal_id
     WHERE s.id = ? AND s.deleted_at IS NULL`,
    [id],
  )) as SolicitudContexto[]
  return rows[0] ?? null
}

async function loadPago(id: number): Promise<PagoContexto | null> {
  const rows = (await query(
    `SELECT m.id, m.concepto, m.monto, m.moneda, m.fecha, m.prioridad, m.estado, m.motivo_rechazo,
            m.sucursal_id, su.nombre AS sucursal_nombre, m.user_id,
            uc.nombre AS creador_nombre,
            ur.nombre AS revisor_nombre
     FROM movimientos m
     LEFT JOIN sucursales su ON su.id = m.sucursal_id
     LEFT JOIN usuarios uc ON uc.id = m.user_id
     LEFT JOIN usuarios ur ON ur.id = m.usuario_revisor_id
     WHERE m.id = ?`,
    [id],
  )) as PagoContexto[]
  return rows[0] ?? null
}

export async function buildContexto(tipo: NotificacionTipo, entidadId: number): Promise<NotificacionContexto | null> {
  if (tipo.startsWith('solicitud_rrhh_')) {
    const solicitud = await loadSolicitud(entidadId)
    if (!solicitud) return null
    const accionLabel =
      tipo === 'solicitud_rrhh_creada' ? 'creada' : tipo === 'solicitud_rrhh_aprobada' ? 'aprobada' : 'rechazada'
    return {
      kind: 'solicitud',
      solicitud,
      tipoLabel: TIPO_LABELS[tipo],
      titulo: `Solicitud de RRHH ${accionLabel}`,
      resumen: `${solicitud.tipo} · ${solicitud.sucursal_nombre}${
        solicitud.colaborador_nombre ? ` · ${solicitud.colaborador_nombre}` : ''
      }`,
      sucursalId: solicitud.sucursal_id,
      actorUserId: solicitud.usuario_id,
    }
  }
  const pago = await loadPago(entidadId)
  if (!pago) return null
  const accionLabel =
    tipo === 'pago_pendiente_creado' ? 'creado' : tipo === 'pago_pendiente_aprobado' ? 'aprobado' : 'rechazado'
  return {
    kind: 'pago',
    pago,
    tipoLabel: TIPO_LABELS[tipo],
    titulo: `Pago ${accionLabel}`,
    resumen:
      `${pago.concepto || 'Pago'} · ${formatMonto(pago.monto, pago.moneda || 'ARS')} · ${pago.sucursal_nombre ?? ''}`.trim(),
    sucursalId: pago.sucursal_id,
    actorUserId: pago.user_id,
  }
}

function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr><td style="background:#111827;padding:28px 36px;"><span style="color:#fff;font-size:20px;font-weight:700;">Heroica</span></td></tr>
        <tr><td style="padding:36px;">${content}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function detailRow(label: string, value: string): string {
  return `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:160px;">${label}</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:500;">${value}</td></tr>`
}

function mensajeExtraHtml(mensaje: string | null | undefined): string {
  if (!mensaje || !mensaje.trim()) return ''
  const safe = mensaje.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
  return `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:16px 18px;margin-top:20px;">
            <p style="margin:0 0 6px;color:#92400e;font-size:12px;text-transform:uppercase;font-weight:600;">Mensaje del remitente</p>
            <p style="margin:0;color:#111827;font-size:14px;">${safe}</p>
          </div>`
}

function buildSolicitudHtml(
  contexto: SolicitudContextoCompleto,
  tipo: NotificacionTipo,
  mensajeExtra: string | null,
  remitenteNombre: string,
): string {
  const { solicitud, titulo } = contexto
  const motivo = solicitud.motivo_resolucion
    ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin-top:20px;">
         <p style="margin:0 0 6px;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:600;">Motivo</p>
         <p style="margin:0;color:#111827;font-size:14px;">${solicitud.motivo_resolucion}</p>
       </div>`
    : ''
  const estadoColor =
    tipo === 'solicitud_rrhh_aprobada' ? '#16a34a' : tipo === 'solicitud_rrhh_rechazada' ? '#dc2626' : '#2563eb'
  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">${titulo}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">${remitenteNombre} quiere informarte sobre esta solicitud.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Estado', `<span style="color:${estadoColor};font-weight:700;">${solicitud.estado}</span>`)}
        ${detailRow('Tipo', solicitud.tipo)}
        ${detailRow('Sucursal', solicitud.sucursal_nombre)}
        ${detailRow('Solicitante', solicitud.solicitante_nombre)}
        ${detailRow('Colaborador', solicitud.colaborador_nombre ?? 'General / Sin asignar')}
        ${detailRow('Fecha', formatFecha(solicitud.fecha_solicitud))}
        ${solicitud.resuelto_por_nombre ? detailRow('Revisado por', solicitud.resuelto_por_nombre) : ''}
      </table>
    </div>
    ${motivo}
    ${mensajeExtraHtml(mensajeExtra)}
  `
  return layout(`${titulo} — Heroica`, content)
}

function buildPagoHtml(
  contexto: PagoContextoCompleto,
  tipo: NotificacionTipo,
  mensajeExtra: string | null,
  remitenteNombre: string,
): string {
  const { pago, titulo } = contexto
  const motivo = pago.motivo_rechazo
    ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin-top:20px;">
         <p style="margin:0 0 6px;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:600;">Motivo de rechazo</p>
         <p style="margin:0;color:#111827;font-size:14px;">${pago.motivo_rechazo}</p>
       </div>`
    : ''
  const estadoColor =
    tipo === 'pago_pendiente_aprobado' ? '#16a34a' : tipo === 'pago_pendiente_rechazado' ? '#dc2626' : '#2563eb'
  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">${titulo}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">${remitenteNombre} quiere informarte sobre este pago.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Estado', `<span style="color:${estadoColor};font-weight:700;">${pago.estado}</span>`)}
        ${detailRow('Concepto', pago.concepto || '—')}
        ${detailRow('Monto', formatMonto(pago.monto, pago.moneda || 'ARS'))}
        ${detailRow('Sucursal', pago.sucursal_nombre ?? '—')}
        ${detailRow('Solicitado por', pago.creador_nombre ?? '—')}
        ${pago.revisor_nombre ? detailRow('Revisado por', pago.revisor_nombre) : ''}
        ${detailRow('Fecha', formatFecha(pago.fecha))}
        ${pago.prioridad ? detailRow('Prioridad', pago.prioridad) : ''}
      </table>
    </div>
    ${motivo}
    ${mensajeExtraHtml(mensajeExtra)}
  `
  return layout(`${titulo} — Heroica`, content)
}

export function buildEmail(
  contexto: NotificacionContexto,
  tipo: NotificacionTipo,
  mensajeExtra: string | null,
  remitenteNombre: string,
): { subject: string; html: string } {
  const subject = `[Heroica] ${contexto.titulo}`
  const html =
    contexto.kind === 'solicitud'
      ? buildSolicitudHtml(contexto, tipo, mensajeExtra, remitenteNombre)
      : buildPagoHtml(contexto, tipo, mensajeExtra, remitenteNombre)
  return { subject, html }
}

export async function sendNotificacionEmail(
  destinatarios: string[],
  subject: string,
  html: string,
): Promise<{ enviados: number; error: string | null }> {
  const lista = [...new Set(destinatarios.map(e => e.trim()).filter(Boolean))]
  if (lista.length === 0) return { enviados: 0, error: null }
  if (!process.env.RESEND_API_KEY) {
    console.warn('[notificacionesEmailService] RESEND_API_KEY no configurada; email omitido.')
    return { enviados: 0, error: 'RESEND_API_KEY no configurada' }
  }
  try {
    await resend.emails.send({ from: FROM, to: lista, subject, html })
    return { enviados: lista.length, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('[notificacionesEmailService] Error enviando email:', error)
    return { enviados: 0, error: message }
  }
}
