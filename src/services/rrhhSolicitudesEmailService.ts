import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM ?? 'noreply@adminheroica.com'

interface NuevaSolicitudEmailData {
  destinatarios: string[]
  sucursalNombre: string
  tipo: string
  solicitanteNombre: string
  colaboradorNombre?: string | null
  fechaSolicitud: string
}

interface SolicitudResueltaEmailData {
  destinatario: string
  destinatarioNombre: string
  estado: 'Aprobada' | 'Rechazada'
  tipo: string
  sucursalNombre: string
  solicitanteNombre: string
  revisorNombre: string
  colaboradorNombre?: string | null
  motivoResolucion?: string | null
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

function nuevaSolicitudHtml(data: NuevaSolicitudEmailData): string {
  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Nueva solicitud pendiente</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Se registró una nueva solicitud de RRHH que requiere revisión.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Tipo', data.tipo)}
        ${detailRow('Sucursal', data.sucursalNombre)}
        ${detailRow('Solicitante', data.solicitanteNombre)}
        ${detailRow('Colaborador', data.colaboradorNombre ?? 'General / Sin asignar')}
        ${detailRow('Fecha', data.fechaSolicitud)}
      </table>
    </div>
  `
  return layout('Nueva solicitud RRHH — Heroica', content)
}

function solicitudResueltaHtml(data: SolicitudResueltaEmailData): string {
  const estadoColor = data.estado === 'Aprobada' ? '#16a34a' : '#dc2626'
  const motivo = data.motivoResolucion
    ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin-top:20px;">
         <p style="margin:0 0 6px;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:600;">Motivo</p>
         <p style="margin:0;color:#111827;font-size:14px;">${data.motivoResolucion}</p>
       </div>`
    : ''

  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Solicitud ${data.estado}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${data.destinatarioNombre}</strong>, tu solicitud fue revisada.</p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Estado', `<span style="color:${estadoColor};font-weight:700;">${data.estado}</span>`)}
        ${detailRow('Tipo', data.tipo)}
        ${detailRow('Sucursal', data.sucursalNombre)}
        ${detailRow('Solicitante', data.solicitanteNombre)}
        ${detailRow('Revisado por', data.revisorNombre)}
        ${detailRow('Colaborador', data.colaboradorNombre ?? 'General / Sin asignar')}
      </table>
    </div>
    ${motivo}
  `
  return layout(`Solicitud ${data.estado} — Heroica`, content)
}

export async function sendNuevaSolicitudEmail(data: NuevaSolicitudEmailData): Promise<void> {
  if (!process.env.RESEND_API_KEY || data.destinatarios.length === 0) return

  try {
    await resend.emails.send({
      from: FROM,
      to: data.destinatarios,
      subject: `[Heroica] Nueva solicitud pendiente — ${data.tipo}`,
      html: nuevaSolicitudHtml(data),
    })
  } catch (error) {
    console.error('[rrhhSolicitudesEmailService] Error enviando nueva solicitud:', error)
  }
}

export async function sendSolicitudResueltaEmail(data: SolicitudResueltaEmailData): Promise<void> {
  if (!process.env.RESEND_API_KEY || !data.destinatario) return

  try {
    await resend.emails.send({
      from: FROM,
      to: data.destinatario,
      subject: `[Heroica] Solicitud ${data.estado.toLowerCase()} — ${data.tipo}`,
      html: solicitudResueltaHtml(data),
    })
  } catch (error) {
    console.error('[rrhhSolicitudesEmailService] Error enviando resolución de solicitud:', error)
  }
}
