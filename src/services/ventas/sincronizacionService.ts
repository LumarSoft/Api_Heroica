import type { ResultSetHeader } from 'mysql2/promise'
import { query } from '../../config/database'
import {
  BistrosoftLimiteError,
  bistrosoftConfigurado,
  obtenerUltimaLlamada,
  registrarUltimaLlamada,
} from './bistrosoftClient'
import { importarDia, listarDias, type ContadoresDia } from './importacionDia'
import type { FuenteVentas, OrigenSincronizacion } from './types'

/**
 * Orquestación de las sincronizaciones de ventas, pensada para Vercel (serverless):
 * no hay procesos de fondo ni node-cron. Una corrida queda registrada "en curso" con
 * `proximo_dia` y cada invocación de `procesarPendientes` avanza días hasta agotar su
 * presupuesto de tiempo. La siguiente invocación retoma donde quedó.
 *
 * Quién invoca:
 *  - Vercel Cron → GET /api/ventas/cron (ver vercel.json).
 *  - La app al abrir el panel o la pantalla de integraciones → POST /api/ventas/integraciones/procesar.
 *
 * Una sola invocación procesa por fuente a la vez: candado con vencimiento en
 * `ventas_fuentes_estado`, que además guarda la última llamada a la API externa para
 * respetar el rate limit entre instancias distintas.
 */

/** Un año: la corrida avanza por tramos, así que un rango largo solo tarda más (~6 s por día). */
export const MAX_DIAS_SINCRONIZACION = 366
const PRESUPUESTO_DEFAULT_MS = 40_000
const INTERVALO_DEFAULT_MIN = 30
const HORAS_ENTRE_REVISIONES = 20
const DIAS_REVISION = 7
const MARGEN_CANDADO_S = 120

export class SincronizacionEnCursoError extends Error {
  constructor(fuente: FuenteVentas) {
    super(`Ya hay una sincronización de ${fuente} en curso`)
    this.name = 'SincronizacionEnCursoError'
  }
}

export interface ResultadoProceso {
  /** false si otra invocación tenía el candado. */
  ejecutada: boolean
  diasProcesados: number
  lineasImportadas: number
  quedanPendientes: boolean
}

function numeroEnv(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre])
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto
}

export function syncAutomaticaHabilitada(): boolean {
  return process.env.VENTAS_SYNC_DISABLED !== 'true' && bistrosoftConfigurado()
}

/** YYYY-MM-DD en Argentina (UTC-3), `diasAtras` días antes de hoy. */
export function fechaArgentina(diasAtras = 0): string {
  return new Date(Date.now() - 3 * 3_600_000 - diasAtras * 86_400_000).toISOString().slice(0, 10)
}

export async function haySincronizacionPendiente(fuente: FuenteVentas): Promise<boolean> {
  const filas = (await query(`SELECT 1 FROM ventas_sincronizaciones WHERE fuente = ? AND estado = 'en_curso' LIMIT 1`, [
    fuente,
  ])) as unknown[]
  return filas.length > 0
}

async function insertarSincronizacion(
  fuente: FuenteVentas,
  origen: OrigenSincronizacion,
  desde: string,
  hasta: string,
  userId: number | null,
): Promise<number> {
  const resultado = (await query(
    `INSERT INTO ventas_sincronizaciones (fuente, origen, user_id, fecha_desde, fecha_hasta, proximo_dia, mensaje)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    [fuente, origen, userId, desde, hasta, desde],
  )) as ResultSetHeader
  return resultado.insertId
}

/** Registra una corrida manual. La procesan las invocaciones siguientes. */
export async function crearSincronizacionManual(opciones: {
  fuente: FuenteVentas
  desde: string
  hasta: string
  userId: number | null
}): Promise<number> {
  const { fuente, desde, hasta, userId } = opciones
  if (fuente !== 'bistrosoft') throw new Error('La integración con Hiopos todavía no está disponible')
  if (!bistrosoftConfigurado()) throw new Error('Bistrosoft no está configurado en el servidor')

  const dias = listarDias(desde, hasta)
  if (dias.length === 0) throw new Error('El rango de fechas es inválido')
  if (dias.length > MAX_DIAS_SINCRONIZACION) {
    throw new Error(`El rango no puede superar ${MAX_DIAS_SINCRONIZACION} días`)
  }
  if (await haySincronizacionPendiente(fuente)) throw new SincronizacionEnCursoError(fuente)

  return insertarSincronizacion(fuente, 'manual', desde, hasta, userId)
}

/**
 * Crea la corrida automática que corresponda, si no hay ninguna pendiente:
 *  - revisión de los últimos 7 días cada 20 h (anulaciones y correcciones tardías);
 *  - si no, ayer + hoy cada VENTAS_SYNC_INTERVALO_MIN minutos (30 por defecto).
 * Se llama con el candado tomado, así dos invocaciones no crean corridas duplicadas.
 */
async function asegurarSincronizacionAutomatica(fuente: FuenteVentas): Promise<void> {
  if (fuente !== 'bistrosoft' || !syncAutomaticaHabilitada()) return
  if (await haySincronizacionPendiente(fuente)) return

  const [fila] = (await query(
    `SELECT TIMESTAMPDIFF(MINUTE, MAX(iniciada_at), NOW()) AS minutos,
            TIMESTAMPDIFF(HOUR, MAX(CASE WHEN DATEDIFF(fecha_hasta, fecha_desde) >= ? THEN iniciada_at END), NOW()) AS horas_revision
     FROM ventas_sincronizaciones WHERE fuente = ? AND origen = 'automatica'`,
    [DIAS_REVISION - 1, fuente],
  )) as Array<{ minutos: number | null; horas_revision: number | null }>

  const intervalo = numeroEnv('VENTAS_SYNC_INTERVALO_MIN', INTERVALO_DEFAULT_MIN)
  if (
    fila?.horas_revision === null ||
    fila?.horas_revision === undefined ||
    fila.horas_revision >= HORAS_ENTRE_REVISIONES
  ) {
    await insertarSincronizacion(fuente, 'automatica', fechaArgentina(DIAS_REVISION), fechaArgentina(0), null)
  } else if (fila.minutos === null || fila.minutos >= intervalo) {
    await insertarSincronizacion(fuente, 'automatica', fechaArgentina(1), fechaArgentina(0), null)
  }
}

async function tomarCandado(fuente: FuenteVentas, segundos: number): Promise<boolean> {
  const resultado = (await query(
    `UPDATE ventas_fuentes_estado SET lock_hasta = DATE_ADD(NOW(), INTERVAL ? SECOND)
     WHERE fuente = ? AND (lock_hasta IS NULL OR lock_hasta < NOW())`,
    [segundos, fuente],
  )) as ResultSetHeader
  if (resultado.affectedRows === 0) return false

  const [estado] = (await query('SELECT ultima_llamada_ms FROM ventas_fuentes_estado WHERE fuente = ?', [
    fuente,
  ])) as Array<{ ultima_llamada_ms: number | string | null }>
  registrarUltimaLlamada(estado?.ultima_llamada_ms === null ? null : Number(estado?.ultima_llamada_ms))
  return true
}

async function soltarCandado(fuente: FuenteVentas): Promise<void> {
  await query(
    `UPDATE ventas_fuentes_estado
     SET lock_hasta = NULL, ultima_llamada_ms = GREATEST(COALESCE(ultima_llamada_ms, 0), ?)
     WHERE fuente = ?`,
    [obtenerUltimaLlamada(), fuente],
  )
}

async function sumarDia(id: number, dia: string, c: ContadoresDia): Promise<void> {
  await query(
    `UPDATE ventas_sincronizaciones
     SET paginas = paginas + ?, registros_recibidos = registros_recibidos + ?,
         registros_importados = registros_importados + ?, registros_observados = registros_observados + ?,
         registros_rechazados = registros_rechazados + ?, registros_reemplazados = registros_reemplazados + ?,
         dias_nuevos = dias_nuevos + ?, dias_actualizados = dias_actualizados + ?,
         proximo_dia = DATE_ADD(?, INTERVAL 1 DAY), mensaje = ?
     WHERE id = ?`,
    [
      c.paginas,
      c.recibidos,
      c.importados,
      c.observados,
      c.rechazados,
      c.reemplazados,
      c.diaNuevo ? 1 : 0,
      c.diaNuevo ? 0 : 1,
      dia,
      null,
      id,
    ],
  )
}

async function finalizar(id: number): Promise<void> {
  // Solo es "con observaciones" si hubo datos de la fuente que no se pudieron leer. Un
  // local todavía sin sucursal NO es un problema de la corrida: se avisa en Locales.
  const [fila] = (await query('SELECT registros_rechazados AS rechazados FROM ventas_sincronizaciones WHERE id = ?', [
    id,
  ])) as Array<{ rechazados: number }>
  const rechazados = Number(fila?.rechazados ?? 0)

  await query(
    `UPDATE ventas_sincronizaciones
     SET estado = ?, mensaje = ?, proximo_dia = NULL, finalizada_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [
      rechazados > 0 ? 'con_observaciones' : 'exitosa',
      rechazados > 0 ? `${rechazados} registros de la fuente no se pudieron leer (sin importe) y se omitieron.` : null,
      id,
    ],
  )
}

async function marcarFallida(id: number, desde: string, dia: string, detalle: string): Promise<void> {
  const [anio, mes, d] = dia.split('-')
  const mensaje = dia > desde ? `${detalle}. Quedaron importados los días anteriores al ${d}/${mes}/${anio}.` : detalle
  await query(
    `UPDATE ventas_sincronizaciones
     SET estado = 'fallida', mensaje = ?, proximo_dia = NULL, finalizada_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [mensaje, id],
  )
}

/**
 * Avanza las corridas pendientes de la fuente (la más antigua primero) hasta agotar
 * el presupuesto de tiempo (VENTAS_SYNC_PRESUPUESTO_MS, 40 s por defecto; debe quedar
 * holgado respecto del maxDuration de la función en Vercel).
 */
export async function procesarPendientes(
  fuente: FuenteVentas,
  opciones: { crearAutomatica: boolean },
): Promise<ResultadoProceso> {
  const presupuesto = numeroEnv('VENTAS_SYNC_PRESUPUESTO_MS', PRESUPUESTO_DEFAULT_MS)
  const resultado: ResultadoProceso = {
    ejecutada: false,
    diasProcesados: 0,
    lineasImportadas: 0,
    quedanPendientes: false,
  }

  if (fuente !== 'bistrosoft' || !bistrosoftConfigurado()) return resultado
  if (!(await tomarCandado(fuente, Math.ceil(presupuesto / 1000) + MARGEN_CANDADO_S))) {
    resultado.quedanPendientes = await haySincronizacionPendiente(fuente)
    return resultado
  }
  resultado.ejecutada = true

  try {
    if (opciones.crearAutomatica) await asegurarSincronizacionAutomatica(fuente)
    const inicio = Date.now()

    while (Date.now() - inicio < presupuesto) {
      const [corrida] = (await query(
        `SELECT id, DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS desde, DATE_FORMAT(fecha_hasta, '%Y-%m-%d') AS hasta,
                DATE_FORMAT(proximo_dia, '%Y-%m-%d') AS dia
         FROM ventas_sincronizaciones WHERE fuente = ? AND estado = 'en_curso' ORDER BY id LIMIT 1`,
        [fuente],
      )) as Array<{ id: number; desde: string; hasta: string; dia: string | null }>
      if (!corrida) break

      if (!corrida.dia || corrida.dia > corrida.hasta) {
        await finalizar(corrida.id)
        continue
      }

      try {
        const contadores = await importarDia(fuente, corrida.id, corrida.dia)
        await sumarDia(corrida.id, corrida.dia, contadores)
        resultado.diasProcesados++
        resultado.lineasImportadas += contadores.importados
        if (corrida.dia === corrida.hasta) await finalizar(corrida.id)
      } catch (err: unknown) {
        if (err instanceof BistrosoftLimiteError) {
          // No es una falla: la corrida sigue en cola y la retoma la próxima invocación.
          await query('UPDATE ventas_sincronizaciones SET mensaje = ? WHERE id = ?', [
            'Bistrosoft pidió esperar un momento; se retoma sola.',
            corrida.id,
          ])
          break
        }
        const detalle = err instanceof Error ? err.message : 'Error desconocido'
        console.error(`[Ventas] Sincronización ${fuente} #${corrida.id} fallida:`, detalle)
        await marcarFallida(corrida.id, corrida.desde, corrida.dia, detalle)
      }
    }
  } finally {
    await soltarCandado(fuente)
  }

  resultado.quedanPendientes = await haySincronizacionPendiente(fuente)
  return resultado
}

export { reasignarLineasDeLocal } from './importacionDia'
