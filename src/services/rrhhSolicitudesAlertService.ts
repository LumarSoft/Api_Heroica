import cron from 'node-cron'
import { query } from '../config/database'
import { sendSegundoApercibimientoEmail, sendVencimientoRrhhEmail } from './emailService'

interface BaseAlertaRow {
  personal_id: number
  legajo: string
  colaborador_nombre: string
  dni: string
  personal_email: string | null
  sucursal_nombre: string
  sucursal_email: string | null
  puesto_nombre: string | null
}

interface ApercibimientoRow extends BaseAlertaRow {
  solicitud_id: number
  cantidad_apercibimientos: number
  fecha_ultimo_apercibimiento: string
}

interface VencimientoRow extends BaseAlertaRow {
  solicitud_id: number
  tipo: 'Licencias' | 'Vacaciones'
  fecha_desde: string
  fecha_vencimiento: string
  dias_restantes: number
}

const DEFAULT_DIAS_ANTES_VENCIMIENTO = 7

function getDiasAntesVencimiento(): number {
  const value = Number(process.env.RRHH_ALERTA_VENCIMIENTOS_DIAS_ANTES)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DIAS_ANTES_VENCIMIENTO
}

function getDestinatario(row: BaseAlertaRow): string | null {
  return process.env.RRHH_RESPONSABLE_EMAIL || row.sucursal_email || process.env.EMAIL_APROBACION || null
}

function formatDateForEmail(value: string): string {
  const [year, month, day] = value.split('T')[0].split('-')
  return `${day}/${month}/${year}`
}

async function getSegundosApercibimientosPendientes(): Promise<ApercibimientoRow[]> {
  const rows = await query(
    `SELECT p.id AS personal_id,
            p.legajo,
            p.nombre AS colaborador_nombre,
            p.dni,
            p.email AS personal_email,
            s.nombre AS sucursal_nombre,
            s.email_correspondencia AS sucursal_email,
            pu.nombre AS puesto_nombre,
            MAX(sol.id) AS solicitud_id,
            COUNT(sol.id) AS cantidad_apercibimientos,
            DATE_FORMAT(MAX(COALESCE(sol.fecha_resolucion, sol.fecha_solicitud)), '%Y-%m-%d') AS fecha_ultimo_apercibimiento
     FROM rrhh_solicitudes sol
     INNER JOIN personal p ON p.id = sol.personal_id
     INNER JOIN sucursales s ON s.id = sol.sucursal_id
     LEFT JOIN puestos pu ON pu.id = p.puesto_id
     LEFT JOIN rrhh_alertas_apercibimientos a ON a.personal_id = p.id
     WHERE sol.deleted_at IS NULL
       AND sol.tipo = 'Apercibimientos'
       AND sol.estado = 'Aprobada'
       AND sol.personal_id IS NOT NULL
       AND p.deleted_at IS NULL
       AND p.activo = 1
       AND s.deleted_at IS NULL
       AND a.id IS NULL
     GROUP BY p.id, p.legajo, p.nombre, p.dni, p.email, s.nombre, s.email_correspondencia, pu.nombre
     HAVING COUNT(sol.id) >= 2
     ORDER BY fecha_ultimo_apercibimiento ASC`,
  )

  return rows as ApercibimientoRow[]
}

async function getVencimientosPendientes(): Promise<VencimientoRow[]> {
  const diasAntes = getDiasAntesVencimiento()

  const rows = await query(
    `SELECT sol.id AS solicitud_id,
            sol.personal_id,
            sol.tipo,
            p.legajo,
            p.nombre AS colaborador_nombre,
            p.dni,
            p.email AS personal_email,
            s.nombre AS sucursal_nombre,
            s.email_correspondencia AS sucursal_email,
            pu.nombre AS puesto_nombre,
            DATE_FORMAT(JSON_UNQUOTE(JSON_EXTRACT(sol.detalles, '$.fecha_desde')), '%Y-%m-%d') AS fecha_desde,
            DATE_FORMAT(JSON_UNQUOTE(JSON_EXTRACT(sol.detalles, '$.fecha_hasta')), '%Y-%m-%d') AS fecha_vencimiento,
            DATEDIFF(JSON_UNQUOTE(JSON_EXTRACT(sol.detalles, '$.fecha_hasta')), CURDATE()) AS dias_restantes
     FROM rrhh_solicitudes sol
     INNER JOIN personal p ON p.id = sol.personal_id
     INNER JOIN sucursales s ON s.id = sol.sucursal_id
     LEFT JOIN puestos pu ON pu.id = p.puesto_id
     LEFT JOIN rrhh_alertas_vencimientos a ON a.solicitud_id = sol.id
     WHERE sol.deleted_at IS NULL
       AND sol.tipo IN ('Licencias', 'Vacaciones')
       AND sol.estado = 'Aprobada'
       AND sol.personal_id IS NOT NULL
       AND p.deleted_at IS NULL
       AND p.activo = 1
       AND s.deleted_at IS NULL
       AND a.id IS NULL
       AND JSON_UNQUOTE(JSON_EXTRACT(sol.detalles, '$.fecha_hasta')) IS NOT NULL
       AND DATEDIFF(JSON_UNQUOTE(JSON_EXTRACT(sol.detalles, '$.fecha_hasta')), CURDATE()) BETWEEN 0 AND ?
     ORDER BY dias_restantes ASC, sol.fecha_solicitud ASC`,
    [diasAntes],
  )

  return rows as VencimientoRow[]
}

async function crearEventoCalendarioApercibimiento(row: ApercibimientoRow): Promise<number | null> {
  const today = new Date().toISOString().split('T')[0]
  const existing = await query(
    `SELECT id
     FROM rrhh_calendario_eventos
     WHERE deleted_at IS NULL
       AND evento = 'Alerta RRHH'
       AND comentarios LIKE ?
     LIMIT 1`,
    [`%segundo apercibimiento%Legajo ${row.legajo}%`],
  ) as Array<{ id: number }>

  if (existing.length > 0) return existing[0].id

  const result = await query(
    `INSERT INTO rrhh_calendario_eventos
     (evento, fecha, hora, direccion, participantes, comentarios, tipo_notion, creado_por)
     VALUES ('Alerta RRHH', ?, NULL, NULL, ?, ?, 'Recordatorio', NULL)`,
    [
      today,
      row.colaborador_nombre,
      `Alerta preventiva por segundo apercibimiento. Colaborador: ${row.colaborador_nombre}. Legajo ${row.legajo}. Sucursal: ${row.sucursal_nombre}.`,
    ],
  ) as { insertId: number }

  return result.insertId
}

async function crearEventoCalendarioVencimiento(row: VencimientoRow): Promise<number | null> {
  const existing = await query(
    `SELECT id
     FROM rrhh_calendario_eventos
     WHERE deleted_at IS NULL
       AND evento = 'Vencimiento'
       AND fecha = ?
       AND comentarios LIKE ?
     LIMIT 1`,
    [row.fecha_vencimiento, `%Solicitud ${row.solicitud_id}%`],
  ) as Array<{ id: number }>

  if (existing.length > 0) return existing[0].id

  const result = await query(
    `INSERT INTO rrhh_calendario_eventos
     (evento, fecha, hora, direccion, participantes, comentarios, tipo_notion, creado_por)
     VALUES ('Vencimiento', ?, NULL, NULL, ?, ?, 'Recordatorio', NULL)`,
    [
      row.fecha_vencimiento,
      row.colaborador_nombre,
      `Vencimiento de ${row.tipo.toLowerCase()}. Solicitud ${row.solicitud_id}. Colaborador: ${row.colaborador_nombre}. Legajo ${row.legajo}. Sucursal: ${row.sucursal_nombre}.`,
    ],
  ) as { insertId: number }

  return result.insertId
}

async function registrarAlertaApercibimiento(row: ApercibimientoRow, calendarioEventoId: number | null, destinatario: string | null): Promise<void> {
  await query(
    `INSERT INTO rrhh_alertas_apercibimientos
     (personal_id, solicitud_id, cantidad_apercibimientos, calendario_evento_id, destinatario_email, email_enviado_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       solicitud_id = VALUES(solicitud_id),
       cantidad_apercibimientos = VALUES(cantidad_apercibimientos),
       calendario_evento_id = VALUES(calendario_evento_id),
       destinatario_email = VALUES(destinatario_email),
       email_enviado_at = COALESCE(email_enviado_at, VALUES(email_enviado_at))`,
    [row.personal_id, row.solicitud_id, row.cantidad_apercibimientos, calendarioEventoId, destinatario, destinatario ? new Date() : null],
  )
}

async function registrarAlertaVencimiento(row: VencimientoRow, calendarioEventoId: number | null, destinatario: string | null): Promise<void> {
  await query(
    `INSERT INTO rrhh_alertas_vencimientos
     (solicitud_id, personal_id, tipo, fecha_vencimiento, dias_antes, calendario_evento_id, destinatario_email, email_enviado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       calendario_evento_id = VALUES(calendario_evento_id),
       destinatario_email = VALUES(destinatario_email),
       email_enviado_at = COALESCE(email_enviado_at, VALUES(email_enviado_at))`,
    [row.solicitud_id, row.personal_id, row.tipo, row.fecha_vencimiento, getDiasAntesVencimiento(), calendarioEventoId, destinatario, destinatario ? new Date() : null],
  )
}

export async function procesarAlertasSegundoApercibimiento(): Promise<void> {
  const rows = await getSegundosApercibimientosPendientes()
  if (rows.length === 0) return

  for (const row of rows) {
    const destinatario = getDestinatario(row)
    const calendarioEventoId = await crearEventoCalendarioApercibimiento(row)

    if (destinatario) {
      const payload = {
        destinatario,
        colaboradorNombre: row.colaborador_nombre,
        legajo: row.legajo,
        dni: row.dni,
        sucursal: row.sucursal_nombre,
        puesto: row.puesto_nombre ?? '-',
        cantidadApercibimientos: Number(row.cantidad_apercibimientos),
        fechaUltimoApercibimiento: formatDateForEmail(row.fecha_ultimo_apercibimiento),
      }
      await sendSegundoApercibimientoEmail(payload)
      if (row.personal_email && row.personal_email !== destinatario) {
        await sendSegundoApercibimientoEmail({ ...payload, destinatario: row.personal_email })
      }
    } else {
      console.error('[rrhhSolicitudesAlertService] No hay destinatario configurado para alertas de apercibimientos')
    }

    await registrarAlertaApercibimiento(row, calendarioEventoId, destinatario)
  }
}

export async function procesarAlertasVencimientosSolicitudes(): Promise<void> {
  const rows = await getVencimientosPendientes()
  if (rows.length === 0) return

  for (const row of rows) {
    const destinatario = getDestinatario(row)
    const calendarioEventoId = await crearEventoCalendarioVencimiento(row)

    if (destinatario) {
      const payload = {
        destinatario,
        tipo: row.tipo,
        colaboradorNombre: row.colaborador_nombre,
        legajo: row.legajo,
        dni: row.dni,
        sucursal: row.sucursal_nombre,
        puesto: row.puesto_nombre ?? '-',
        fechaDesde: formatDateForEmail(row.fecha_desde),
        fechaVencimiento: formatDateForEmail(row.fecha_vencimiento),
        diasRestantes: Number(row.dias_restantes),
      }
      await sendVencimientoRrhhEmail(payload)
      if (row.personal_email && row.personal_email !== destinatario) {
        await sendVencimientoRrhhEmail({ ...payload, destinatario: row.personal_email })
      }
    } else {
      console.error('[rrhhSolicitudesAlertService] No hay destinatario configurado para alertas de vencimientos RRHH')
    }

    await registrarAlertaVencimiento(row, calendarioEventoId, destinatario)
  }
}

export async function procesarAlertasSolicitudesRrhh(): Promise<void> {
  await procesarAlertasSegundoApercibimiento()
  await procesarAlertasVencimientosSolicitudes()
}

export function startSolicitudesRrhhAlertCron(): void {
  cron.schedule('10 8 * * *', () => {
    procesarAlertasSolicitudesRrhh().catch(error => {
      console.error('[rrhhSolicitudesAlertService] Error procesando alertas:', error)
    })
  })

  console.log('📅 Tarea programada (CRON): Alertas de solicitudes RRHH (08:10).')

  procesarAlertasSolicitudesRrhh().catch(error => {
    console.error('[rrhhSolicitudesAlertService] Error inicial procesando alertas:', error)
  })
}
