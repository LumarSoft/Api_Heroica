import cron from 'node-cron'
import { query } from '../config/database'
import { sendPeriodoPruebaPorVencerEmail } from './emailService'

interface PersonalPeriodoPruebaRow {
  id: number
  legajo: string
  nombre: string
  dni: string
  fecha_incorporacion: string
  fecha_vencimiento: string
  dias_restantes: number
  sucursal_nombre: string
  sucursal_email: string | null
  puesto_nombre: string
}

const DEFAULT_DIAS_ANTES_ALERTA = 7

function getDiasAntesAlerta(): number {
  const value = Number(process.env.RRHH_ALERTA_PERIODO_PRUEBA_DIAS_ANTES)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DIAS_ANTES_ALERTA
}

function getDestinatario(row: PersonalPeriodoPruebaRow): string | null {
  return process.env.EMAIL_APROBACION || row.sucursal_email || null
}

function formatDateForEmail(value: string): string {
  const [year, month, day] = value.split('T')[0].split('-')
  return `${day}/${month}/${year}`
}

async function getColaboradoresConPeriodoPorVencer(): Promise<PersonalPeriodoPruebaRow[]> {
  const diasAntes = getDiasAntesAlerta()

  const rows = await query(
    `SELECT p.id, p.legajo, p.nombre, p.dni,
            DATE_FORMAT(p.fecha_incorporacion, '%Y-%m-%d') AS fecha_incorporacion,
            DATE_FORMAT(DATE_ADD(p.fecha_incorporacion, INTERVAL p.periodo_prueba_dias DAY), '%Y-%m-%d') AS fecha_vencimiento,
            DATEDIFF(DATE_ADD(p.fecha_incorporacion, INTERVAL p.periodo_prueba_dias DAY), CURDATE()) AS dias_restantes,
            s.nombre AS sucursal_nombre,
            s.email_correspondencia AS sucursal_email,
            pu.nombre AS puesto_nombre
     FROM personal p
     INNER JOIN sucursales s ON s.id = p.sucursal_id
     LEFT JOIN puestos pu ON pu.id = p.puesto_id
     LEFT JOIN rrhh_alertas_periodo_prueba a
       ON a.personal_id = p.id
      AND a.fecha_vencimiento = DATE_ADD(p.fecha_incorporacion, INTERVAL p.periodo_prueba_dias DAY)
      AND a.dias_antes = ?
     WHERE p.deleted_at IS NULL
       AND p.activo = 1
       AND p.periodo_prueba = 1
       AND p.periodo_prueba_dias IS NOT NULL
       AND s.deleted_at IS NULL
       AND a.id IS NULL
       AND DATEDIFF(DATE_ADD(p.fecha_incorporacion, INTERVAL p.periodo_prueba_dias DAY), CURDATE()) BETWEEN 0 AND ?
     ORDER BY dias_restantes ASC, p.legajo ASC`,
    [diasAntes, diasAntes],
  )

  return rows as PersonalPeriodoPruebaRow[]
}

async function crearEventoCalendario(row: PersonalPeriodoPruebaRow): Promise<number | null> {
  const existing = await query(
    `SELECT id
     FROM rrhh_calendario_eventos
     WHERE deleted_at IS NULL
       AND evento = 'Vencimiento'
       AND fecha = ?
       AND comentarios LIKE ? 
     LIMIT 1`,
    [row.fecha_vencimiento, `%Legajo ${row.legajo}%`],
  ) as Array<{ id: number }>

  if (existing.length > 0) return existing[0].id

  const result = await query(
    `INSERT INTO rrhh_calendario_eventos
     (evento, fecha, hora, direccion, participantes, comentarios, tipo_notion, creado_por)
     VALUES ('Vencimiento', ?, NULL, NULL, ?, ?, 'Recordatorio', NULL)`,
    [
      row.fecha_vencimiento,
      row.nombre,
      `Período de prueba por vencer. Colaborador: ${row.nombre}. Legajo ${row.legajo}. Sucursal: ${row.sucursal_nombre}.`,
    ],
  ) as { insertId: number }

  return result.insertId
}

async function registrarAlerta(
  row: PersonalPeriodoPruebaRow,
  calendarioEventoId: number | null,
  destinatario: string | null,
): Promise<void> {
  await query(
    `INSERT INTO rrhh_alertas_periodo_prueba
     (personal_id, fecha_vencimiento, dias_antes, calendario_evento_id, destinatario_email, email_enviado_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       calendario_evento_id = VALUES(calendario_evento_id),
       destinatario_email = VALUES(destinatario_email),
       email_enviado_at = COALESCE(email_enviado_at, VALUES(email_enviado_at))`,
    [row.id, row.fecha_vencimiento, getDiasAntesAlerta(), calendarioEventoId, destinatario, destinatario ? new Date() : null],
  )
}

export async function procesarAlertasPeriodoPrueba(): Promise<void> {
  const colaboradores = await getColaboradoresConPeriodoPorVencer()

  if (colaboradores.length === 0) return

  for (const row of colaboradores) {
    const destinatario = getDestinatario(row)
    const calendarioEventoId = await crearEventoCalendario(row)

    if (destinatario) {
      await sendPeriodoPruebaPorVencerEmail({
        destinatario,
        colaboradorNombre: row.nombre,
        legajo: row.legajo,
        dni: row.dni,
        sucursal: row.sucursal_nombre,
        puesto: row.puesto_nombre ?? '-',
        fechaIncorporacion: formatDateForEmail(row.fecha_incorporacion),
        fechaVencimiento: formatDateForEmail(row.fecha_vencimiento),
        diasRestantes: Number(row.dias_restantes),
      })
    } else {
      console.error('[rrhhPeriodoPruebaAlertService] No hay destinatario configurado para alertas de período de prueba')
    }

    await registrarAlerta(row, calendarioEventoId, destinatario)
  }
}

export function startPeriodoPruebaAlertCron(): void {
  cron.schedule('0 8 * * *', () => {
    procesarAlertasPeriodoPrueba().catch(error => {
      console.error('[rrhhPeriodoPruebaAlertService] Error procesando alertas:', error)
    })
  })

  console.log('📅 Tarea programada (CRON): Alertas de período de prueba por vencer (08:00).')

  procesarAlertasPeriodoPrueba().catch(error => {
    console.error('[rrhhPeriodoPruebaAlertService] Error inicial procesando alertas:', error)
  })
}
