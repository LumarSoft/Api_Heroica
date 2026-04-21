import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.EMAIL_FROM ?? 'noreply@adminheroica.com'

// ─── Templates ────────────────────────────────────────────────────────────────

function baseLayout(title: string, content: string): string {
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
        <!-- Header -->
        <tr>
          <td style="background:#111827;padding:28px 36px;">
            <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-.3px;">Heroica</span>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:36px 36px 28px;">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:18px 36px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">Este mensaje fue generado automáticamente. No respondas a este correo.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function badge(text: string, color: string): string {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${color};color:#fff;">${text}</span>`
}

function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px;">${label}</td>
    <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:500;">${value}</td>
  </tr>`
}

// ── Tarea: nueva notificación ─────────────────────────────────────────────────

interface TareaEmailData {
  destinatario: string
  destinatarioNombre: string
  remitente: string
  tareaId: string
  tareaTitulo: string
  tipo: string
  descripcion: string
}

function tareaNotificacionHtml(data: TareaEmailData): string {
  const tipoLabel: Record<string, string> = {
    asignacion: 'Asignación',
    cambio_estado: 'Cambio de estado',
    comentario: 'Nuevo comentario',
    mencion: 'Mención',
  }
  const label = tipoLabel[data.tipo] ?? data.tipo

  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Nueva notificación de tarea</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${data.destinatarioNombre}</strong>, tienes una actualización en una tarea.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">Tarea</p>
      <p style="margin:0 0 14px;color:#111827;font-size:16px;font-weight:600;">${data.tareaId} — ${data.tareaTitulo}</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Tipo', label)}
        ${detailRow('De', data.remitente)}
      </table>
    </div>

    <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#1e40af;font-size:14px;">${data.descripcion}</p>
    </div>

    <p style="margin:0;color:#6b7280;font-size:13px;">Ingresá al sistema para ver los detalles completos.</p>
  `
  return baseLayout('Nueva notificación de tarea — Heroica', content)
}

// ── Pago aprobado ─────────────────────────────────────────────────────────────

interface PagoEmailData {
  destinatario: string
  destinatarioNombre: string
  revisorNombre: string
  concepto: string
  monto: string
  moneda: string
  fecha: string
  sucursal?: string
}

function pagoAprobadoHtml(data: PagoEmailData): string {
  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Pago aprobado ${badge('Aprobado', '#16a34a')}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${data.destinatarioNombre}</strong>, tu solicitud de pago fue aprobada.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Concepto', data.concepto)}
        ${detailRow('Monto', `${data.moneda} ${data.monto}`)}
        ${detailRow('Fecha', data.fecha)}
        ${detailRow('Revisado por', data.revisorNombre)}
        ${data.sucursal ? detailRow('Sucursal', data.sucursal) : ''}
      </table>
    </div>

    <div style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#15803d;font-size:14px;">El pago fue revisado y aprobado. Será procesado según la programación establecida.</p>
    </div>

    <p style="margin:0;color:#6b7280;font-size:13px;">Podés consultar el historial completo de pagos en el sistema.</p>
  `
  return baseLayout('Pago aprobado — Heroica', content)
}

// ── Pago rechazado ────────────────────────────────────────────────────────────

interface PagoRechazadoEmailData extends PagoEmailData {
  motivoRechazo: string
}

function pagoRechazadoHtml(data: PagoRechazadoEmailData): string {
  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Pago rechazado ${badge('Rechazado', '#dc2626')}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${data.destinatarioNombre}</strong>, tu solicitud de pago fue rechazada.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Concepto', data.concepto)}
        ${detailRow('Monto', `${data.moneda} ${data.monto}`)}
        ${detailRow('Fecha', data.fecha)}
        ${detailRow('Revisado por', data.revisorNombre)}
        ${data.sucursal ? detailRow('Sucursal', data.sucursal) : ''}
      </table>
    </div>

    <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0 0 4px;color:#991b1b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Motivo del rechazo</p>
      <p style="margin:0;color:#7f1d1d;font-size:14px;">${data.motivoRechazo}</p>
    </div>

    <p style="margin:0;color:#6b7280;font-size:13px;">Si tenés dudas, contactá a tu administrador para más información.</p>
  `
  return baseLayout('Pago rechazado — Heroica', content)
}

// ── Nuevo pago pendiente (para aprobador) ─────────────────────────────────────

interface NuevoPagoEmailData {
  creadorNombre: string
  concepto: string
  monto: string
  moneda: string
  fecha: string
  prioridad?: string
  sucursal?: string
}

function nuevoPagoPendienteHtml(data: NuevoPagoEmailData): string {
  const prioridadColor: Record<string, string> = {
    alta: '#dc2626',
    media: '#d97706',
    baja: '#6b7280',
  }
  const color = prioridadColor[data.prioridad ?? 'media'] ?? '#6b7280'

  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Nuevo pago pendiente de aprobación</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Se registró un nuevo pago que requiere tu revisión.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Solicitado por', data.creadorNombre)}
        ${detailRow('Concepto', data.concepto)}
        ${detailRow('Monto', `${data.moneda} ${data.monto}`)}
        ${detailRow('Fecha', data.fecha)}
        ${data.sucursal ? detailRow('Sucursal', data.sucursal) : ''}
        ${data.prioridad ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px;">Prioridad</td><td style="padding:6px 0;"><span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${color};color:#fff;">${data.prioridad.charAt(0).toUpperCase() + data.prioridad.slice(1)}</span></td></tr>` : ''}
      </table>
    </div>

    <div style="background:#fffbeb;border-left:4px solid #d97706;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#92400e;font-size:14px;">Ingresá al sistema para aprobar o rechazar este pago.</p>
    </div>
  `
  return baseLayout('Nuevo pago pendiente — Heroica', content)
}

// ─── Funciones públicas de envío ──────────────────────────────────────────────

export async function sendTareaNotificacionEmail(data: TareaEmailData): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM,
      to: data.destinatario,
      subject: `[Heroica] Nueva notificación: ${data.tareaId} — ${data.tareaTitulo}`,
      html: tareaNotificacionHtml(data),
    })
  } catch (err) {
    console.error('[emailService] Error enviando email de tarea:', err)
  }
}

export async function sendPagoAprobadoEmail(data: PagoEmailData): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM,
      to: data.destinatario,
      subject: `[Heroica] Tu pago fue aprobado — ${data.concepto}`,
      html: pagoAprobadoHtml(data),
    })
  } catch (err) {
    console.error('[emailService] Error enviando email de pago aprobado:', err)
  }
}

export async function sendPagoRechazadoEmail(data: PagoRechazadoEmailData): Promise<void> {
  try {
    await resend.emails.send({
      from: FROM,
      to: data.destinatario,
      subject: `[Heroica] Tu pago fue rechazado — ${data.concepto}`,
      html: pagoRechazadoHtml(data),
    })
  } catch (err) {
    console.error('[emailService] Error enviando email de pago rechazado:', err)
  }
}

export async function sendNuevoPagoPendienteEmail(data: NuevoPagoEmailData): Promise<void> {
  const aprobadorEmail = process.env.EMAIL_APROBACION
  if (!aprobadorEmail) {
    console.error('[emailService] EMAIL_APROBACION no está definido en las variables de entorno')
    return
  }

  const { data: resendData, error } = await resend.emails.send({
    from: FROM,
    to: aprobadorEmail,
    subject: `[Heroica] Nuevo pago pendiente — ${data.concepto}`,
    html: nuevoPagoPendienteHtml(data),
  })

  if (error) {
    console.error('[emailService] Error al enviar email de nuevo pago:', JSON.stringify(error))
  }
}
