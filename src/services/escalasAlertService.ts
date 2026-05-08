import cron from 'node-cron'
import { query } from '../config/database'
import { sendEscalasDesactualizadasEmail } from './emailService'

const DEFAULT_MESES_SIN_ACTUALIZAR = 3

interface EscalaStaleRow {
  escala_id: number
  puesto_nombre: string
  area_nombre: string
  mes: number
  anio: number
  sueldo_base: string
  ultima_actualizacion: string
  meses_sin_actualizar: number
}

function getMesesSinActualizar(): number {
  const value = Number(process.env.RRHH_ALERTA_ESCALAS_MESES_SIN_ACTUALIZAR)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MESES_SIN_ACTUALIZAR
}

function getDestinatario(): string | null {
  return process.env.RRHH_RESPONSABLE_EMAIL || process.env.EMAIL_APROBACION || null
}

function formatDateForEmail(value: string): string {
  const [year, month, day] = value.split('T')[0].split('-')
  return `${day}/${month}/${year}`
}

async function getEscalasStale(): Promise<EscalaStaleRow[]> {
  const meses = getMesesSinActualizar()

  const rows = await query(
    `SELECT e.id AS escala_id,
            p.nombre AS puesto_nombre,
            ar.nombre AS area_nombre,
            e.mes,
            e.anio,
            e.sueldo_base,
            DATE_FORMAT(COALESCE(e.updated_at, e.created_at), '%Y-%m-%d') AS ultima_actualizacion,
            TIMESTAMPDIFF(MONTH, COALESCE(e.updated_at, e.created_at), NOW()) AS meses_sin_actualizar
     FROM escalas_salariales e
     INNER JOIN puestos p ON p.id = e.puesto_id AND p.deleted_at IS NULL
     INNER JOIN areas ar ON ar.id = p.area_id AND ar.deleted_at IS NULL
     LEFT JOIN rrhh_alertas_escalas_salariales a
       ON a.escala_salarial_id = e.id
       AND a.anio_alerta = YEAR(NOW())
       AND a.mes_alerta = MONTH(NOW())
     WHERE e.deleted_at IS NULL
       AND COALESCE(e.updated_at, e.created_at) < NOW() - INTERVAL ? MONTH
       AND a.id IS NULL
     ORDER BY meses_sin_actualizar DESC, ar.nombre ASC, p.nombre ASC`,
    [meses],
  )

  return rows as EscalaStaleRow[]
}

async function registrarAlertas(rows: EscalaStaleRow[], destinatario: string | null): Promise<void> {
  const now = new Date()
  const anioAlerta = now.getFullYear()
  const mesAlerta = now.getMonth() + 1

  for (const row of rows) {
    await query(
      `INSERT INTO rrhh_alertas_escalas_salariales
       (escala_salarial_id, anio_alerta, mes_alerta, destinatario_email, email_enviado_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         destinatario_email = VALUES(destinatario_email),
         email_enviado_at = COALESCE(email_enviado_at, VALUES(email_enviado_at))`,
      [row.escala_id, anioAlerta, mesAlerta, destinatario, destinatario ? new Date() : null],
    )
  }
}

export async function procesarAlertasEscalasSalariales(): Promise<void> {
  const rows = await getEscalasStale()

  if (rows.length === 0) return

  const destinatario = getDestinatario()
  const meses = getMesesSinActualizar()

  if (destinatario) {
    await sendEscalasDesactualizadasEmail({
      destinatario,
      mesesUmbral: meses,
      escalas: rows.map(r => ({
        puestoNombre: r.puesto_nombre,
        sucursal: r.area_nombre,
        mes: r.mes,
        anio: r.anio,
        sueldoBase: Number(r.sueldo_base).toLocaleString('es-AR', { minimumFractionDigits: 2 }),
        ultimaActualizacion: formatDateForEmail(r.ultima_actualizacion),
        mesesSinActualizar: Number(r.meses_sin_actualizar),
      })),
    })
  } else {
    console.error('[escalasAlertService] No hay destinatario configurado para alertas de escalas salariales')
  }

  await registrarAlertas(rows, destinatario)
}

export function startEscalasAlertCron(): void {
  cron.schedule('20 8 * * *', () => {
    procesarAlertasEscalasSalariales().catch(error => {
      console.error('[escalasAlertService] Error procesando alertas:', error)
    })
  })

  console.log('📅 Tarea programada (CRON): Alertas de escalas salariales desactualizadas (08:20).')

  procesarAlertasEscalasSalariales().catch(error => {
    console.error('[escalasAlertService] Error inicial procesando alertas:', error)
  })
}
