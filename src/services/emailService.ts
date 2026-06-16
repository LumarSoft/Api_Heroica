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

// ── RRHH: período de prueba por vencer ───────────────────────────────────────

interface PeriodoPruebaEmailData {
  destinatario: string
  colaboradorNombre: string
  legajo: string
  dni: string
  sucursal: string
  puesto: string
  fechaIncorporacion: string
  fechaVencimiento: string
  diasRestantes: number
}

interface SegundoApercibimientoEmailData {
  destinatario: string
  colaboradorNombre: string
  legajo: string
  dni: string
  sucursal: string
  puesto: string
  cantidadApercibimientos: number
  fechaUltimoApercibimiento: string
}

interface VencimientoRrhhEmailData {
  destinatario: string
  tipo: 'Licencias' | 'Vacaciones'
  colaboradorNombre: string
  legajo: string
  dni: string
  sucursal: string
  puesto: string
  fechaDesde: string
  fechaVencimiento: string
  diasRestantes: number
}

function periodoPruebaPorVencerHtml(data: PeriodoPruebaEmailData): string {
  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Período de prueba por vencer ${badge('RRHH', '#d97706')}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">El período de prueba de un colaborador está próximo a vencer.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Colaborador', data.colaboradorNombre)}
        ${detailRow('Legajo', data.legajo)}
        ${detailRow('DNI', data.dni)}
        ${detailRow('Sucursal', data.sucursal)}
        ${detailRow('Puesto', data.puesto)}
        ${detailRow('Incorporación', data.fechaIncorporacion)}
        ${detailRow('Vencimiento', data.fechaVencimiento)}
        ${detailRow('Días restantes', String(data.diasRestantes))}
      </table>
    </div>

    <div style="background:#fffbeb;border-left:4px solid #d97706;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#92400e;font-size:14px;">Ingresá a la plataforma para revisar el legajo y definir los próximos pasos.</p>
    </div>
  `
  return baseLayout('Período de prueba por vencer — Heroica', content)
}

function segundoApercibimientoHtml(data: SegundoApercibimientoEmailData): string {
  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Segundo apercibimiento registrado ${badge('Preventivo', '#dc2626')}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Un colaborador acumuló su segundo apercibimiento. Esta alerta es preventiva para seguimiento de RRHH.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Colaborador', data.colaboradorNombre)}
        ${detailRow('Legajo', data.legajo)}
        ${detailRow('DNI', data.dni)}
        ${detailRow('Sucursal', data.sucursal)}
        ${detailRow('Puesto', data.puesto)}
        ${detailRow('Apercibimientos', String(data.cantidadApercibimientos))}
        ${detailRow('Último apercibimiento', data.fechaUltimoApercibimiento)}
      </table>
    </div>

    <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#991b1b;font-size:14px;">Ingresá a la plataforma para revisar el historial del colaborador.</p>
    </div>
  `
  return baseLayout('Segundo apercibimiento — Heroica', content)
}

function vencimientoRrhhHtml(data: VencimientoRrhhEmailData): string {
  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Vencimiento de ${data.tipo.toLowerCase()} ${badge('RRHH', '#d97706')}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hay una solicitud de ${data.tipo.toLowerCase()} próxima a finalizar.</p>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${detailRow('Colaborador', data.colaboradorNombre)}
        ${detailRow('Legajo', data.legajo)}
        ${detailRow('DNI', data.dni)}
        ${detailRow('Sucursal', data.sucursal)}
        ${detailRow('Puesto', data.puesto)}
        ${detailRow('Desde', data.fechaDesde)}
        ${detailRow('Vencimiento', data.fechaVencimiento)}
        ${detailRow('Días restantes', String(data.diasRestantes))}
      </table>
    </div>

    <div style="background:#fffbeb;border-left:4px solid #d97706;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#92400e;font-size:14px;">Ingresá a la plataforma para coordinar el seguimiento correspondiente.</p>
    </div>
  `
  return baseLayout(`Vencimiento de ${data.tipo.toLowerCase()} — Heroica`, content)
}

// ── Escalas salariales desactualizadas ────────────────────────────────────────

const MESES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

interface EscalaItemEmail {
  puestoNombre: string
  sucursal: string
  mes: number
  anio: number
  sueldoBase: string
  ultimaActualizacion: string
  mesesSinActualizar: number
}

export interface EscalasDesactualizadasEmailData {
  destinatario: string
  mesesUmbral: number
  escalas: EscalaItemEmail[]
}

function escalasDesactualizadasHtml(data: EscalasDesactualizadasEmailData): string {
  const filas = data.escalas
    .map(
      e => `
    <tr style="border-top:1px solid #e5e7eb;">
      <td style="padding:10px 12px;font-size:13px;color:#111827;">${e.puestoNombre}</td>
      <td style="padding:10px 12px;font-size:13px;color:#374151;">${e.sucursal}</td>
      <td style="padding:10px 12px;font-size:13px;color:#374151;">${MESES_ES[e.mes - 1]} ${e.anio}</td>
      <td style="padding:10px 12px;font-size:13px;color:#374151;">$ ${e.sueldoBase}</td>
      <td style="padding:10px 12px;font-size:13px;color:#374151;">${e.ultimaActualizacion}</td>
      <td style="padding:10px 12px;text-align:center;">${badge(`${e.mesesSinActualizar} mes${e.mesesSinActualizar !== 1 ? 'es' : ''}`, e.mesesSinActualizar >= 6 ? '#dc2626' : '#d97706')}</td>
    </tr>`,
    )
    .join('')

  const content = `
    <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">Escalas salariales desactualizadas ${badge('RRHH', '#d97706')}</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">
      Las siguientes escalas salariales llevan más de <strong>${data.mesesUmbral} meses</strong> sin actualizarse.
      Por favor, revisá y actualizá los valores correspondientes.
    </p>

    <div style="overflow-x:auto;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Puesto</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Sucursal</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Período</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Sueldo base</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Últ. actualización</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Atraso</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <div style="background:#fffbeb;border-left:4px solid #d97706;border-radius:0 6px 6px 0;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;color:#92400e;font-size:14px;">Ingresá al sistema para actualizar las escalas salariales y mantener la información al día.</p>
    </div>
  `
  return baseLayout('Escalas salariales desactualizadas — Heroica', content)
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

export async function sendPeriodoPruebaPorVencerEmail(data: PeriodoPruebaEmailData): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.error('[emailService] RESEND_API_KEY no está definido; no se envía alerta de período de prueba')
    return
  }

  try {
    await resend.emails.send({
      from: FROM,
      to: data.destinatario,
      subject: `[Heroica] Período de prueba por vencer — ${data.colaboradorNombre}`,
      html: periodoPruebaPorVencerHtml(data),
    })
  } catch (err) {
    console.error('[emailService] Error enviando alerta de período de prueba:', err)
  }
}

export async function sendSegundoApercibimientoEmail(data: SegundoApercibimientoEmailData): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.error('[emailService] RESEND_API_KEY no está definido; no se envía alerta de apercibimientos')
    return
  }

  try {
    await resend.emails.send({
      from: FROM,
      to: data.destinatario,
      subject: `[Heroica] Segundo apercibimiento — ${data.colaboradorNombre}`,
      html: segundoApercibimientoHtml(data),
    })
  } catch (err) {
    console.error('[emailService] Error enviando alerta de apercibimientos:', err)
  }
}

export async function sendVencimientoRrhhEmail(data: VencimientoRrhhEmailData): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.error('[emailService] RESEND_API_KEY no está definido; no se envía alerta de vencimiento RRHH')
    return
  }

  try {
    await resend.emails.send({
      from: FROM,
      to: data.destinatario,
      subject: `[Heroica] Vencimiento de ${data.tipo.toLowerCase()} — ${data.colaboradorNombre}`,
      html: vencimientoRrhhHtml(data),
    })
  } catch (err) {
    console.error('[emailService] Error enviando alerta de vencimiento RRHH:', err)
  }
}

export async function sendEscalasDesactualizadasEmail(data: EscalasDesactualizadasEmailData): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.error('[emailService] RESEND_API_KEY no está definido; no se envía alerta de escalas desactualizadas')
    return
  }

  try {
    await resend.emails.send({
      from: FROM,
      to: data.destinatario,
      subject: `[Heroica] ${data.escalas.length} escala${data.escalas.length !== 1 ? 's' : ''} salarial${data.escalas.length !== 1 ? 'es' : ''} sin actualizar hace más de ${data.mesesUmbral} meses`,
      html: escalasDesactualizadasHtml(data),
    })
  } catch (err) {
    console.error('[emailService] Error enviando alerta de escalas desactualizadas:', err)
  }
}
