import type { ResultSetHeader } from 'mysql2/promise'
import { query } from '../../config/database'
import {
  BistrosoftLimiteError,
  bistrosoftConfigurado,
  obtenerUltimaLlamada,
  registrarUltimaLlamada,
} from './bistrosoftClient'
import { hioposConfigurado, HioposError, HioposSesion } from './hioposClient'
import { guardarConfigHiopos, leerConfigHiopos, type ConfigHiopos } from './hioposMapeo'
import {
  importarCambios,
  importarDiaBistrosoft,
  importarTramo,
  listarDias,
  sumarDias,
  type ContadoresImportacion,
} from './importacion'
import { NOMBRE_FUENTE, type FuenteVentas, type OrigenSincronizacion, type TipoSincronizacion } from './types'

/**
 * Orquestación de las sincronizaciones de ventas de Bistrosoft y Hiopos, pensada para
 * Vercel (serverless): no hay procesos de fondo. Una corrida queda "en curso" con
 * `proximo_dia` y cada invocación de `procesarPendientes` avanza hasta agotar su
 * presupuesto de tiempo. La siguiente invocación retoma donde quedó.
 *
 * Cada fuente tiene su propio candado (`ventas_fuentes_estado`) y sus corridas:
 *  - Hiopos (rápida): tramos de varios días por consulta; un login por invocación.
 *  - Bistrosoft (12 consultas/min): un día por paso; el ritmo de llamadas se comparte entre
 *    instancias guardando la última llamada en la base.
 *
 * Quién invoca: Vercel Cron (GET /api/ventas/cron), node-cron fuera de Vercel y la app al
 * abrir el panel o la pantalla de integraciones (POST /api/ventas/integraciones/procesar).
 */

/** Un año: la corrida avanza por tramos. */
export const MAX_DIAS_SINCRONIZACION = 366
const PRESUPUESTO_DEFAULT_MS = 40_000
const INTERVALO_DEFAULT_MIN = 30
const HORAS_ENTRE_REVISIONES = 20
const DIAS_REVISION = 7
const MARGEN_CANDADO_S = 120
/** Hiopos va primero (es rápida): Bistrosoft usa lo que queda del presupuesto. */
const ORDEN_FUENTES: FuenteVentas[] = ['hiopos', 'bistrosoft']

export class SincronizacionEnCursoError extends Error {
  constructor(fuente: FuenteVentas) {
    super(`Ya hay una sincronización de ${NOMBRE_FUENTE[fuente]} en curso`)
    this.name = 'SincronizacionEnCursoError'
  }
}

export interface ResultadoProceso {
  /** false si ninguna fuente pudo procesar (candado tomado o sin configurar). */
  ejecutada: boolean
  diasProcesados: number
  lineasImportadas: number
  quedanPendientes: boolean
}

function numeroEnv(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre])
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto
}

export function fuenteConfigurada(fuente: FuenteVentas): boolean {
  return fuente === 'hiopos' ? hioposConfigurado() : bistrosoftConfigurado()
}

export function syncAutomaticaHabilitada(fuente: FuenteVentas): boolean {
  return process.env.VENTAS_SYNC_DISABLED !== 'true' && fuenteConfigurada(fuente)
}

/** YYYY-MM-DD en Argentina (UTC-3), `diasAtras` días antes de hoy. */
export function fechaArgentina(diasAtras = 0): string {
  return new Date(Date.now() - 3 * 3_600_000 - diasAtras * 86_400_000).toISOString().slice(0, 10)
}

export async function haySincronizacionPendiente(fuente?: FuenteVentas): Promise<boolean> {
  const filas = (await query(
    `SELECT 1 FROM ventas_sincronizaciones WHERE estado = 'en_curso' ${fuente ? 'AND fuente = ?' : ''} LIMIT 1`,
    fuente ? [fuente] : [],
  )) as unknown[]
  return filas.length > 0
}

async function insertarSincronizacion(
  fuente: FuenteVentas,
  origen: OrigenSincronizacion,
  tipo: TipoSincronizacion,
  desde: string,
  hasta: string,
  userId: number | null,
): Promise<number> {
  const resultado = (await query(
    `INSERT INTO ventas_sincronizaciones (fuente, origen, tipo, user_id, fecha_desde, fecha_hasta, proximo_dia, mensaje)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [fuente, origen, tipo, userId, desde, hasta, desde],
  )) as ResultSetHeader
  return resultado.insertId
}

/** Registra una corrida manual por rango. La procesan las invocaciones siguientes. */
export async function crearSincronizacionManual(opciones: {
  fuente: FuenteVentas
  desde: string
  hasta: string
  userId: number | null
}): Promise<number> {
  const { fuente, desde, hasta, userId } = opciones
  if (fuente === 'bistrosoft' && !bistrosoftConfigurado()) {
    throw new Error('Bistrosoft no está configurado en el servidor (BISTROSOFT_USERNAME / BISTROSOFT_PASSWORD)')
  }
  if (fuente === 'hiopos') {
    if (!hioposConfigurado())
      throw new Error('Hiopos no está configurado en el servidor (HIOPOS_EMAIL / HIOPOS_PASSWORD)')
    const config = await leerConfigHiopos()
    if (!config.exportationId) throw new Error('Falta indicar el dashboard de exportación de HiOffice (exportationId)')
  }

  const dias = listarDias(desde, hasta)
  if (dias.length === 0) throw new Error('El rango de fechas es inválido')
  if (dias.length > MAX_DIAS_SINCRONIZACION) {
    throw new Error(`El rango no puede superar ${MAX_DIAS_SINCRONIZACION} días`)
  }
  if (await haySincronizacionPendiente(fuente)) throw new SincronizacionEnCursoError(fuente)

  return insertarSincronizacion(fuente, 'manual', 'rango', desde, hasta, userId)
}

/**
 * Crea las corridas automáticas que correspondan para la fuente, si no hay ninguna pendiente:
 *  - revisión de los últimos 7 días cada 20 h (correcciones tardías y días que faltaron);
 *  - si no, ayer + hoy cada VENTAS_SYNC_INTERVALO_MIN minutos (30 por defecto);
 *  - Hiopos con filtro de Fecha Modificado: además, los cambios desde la marca de agua.
 * Se llama con el candado de la fuente tomado: dos invocaciones no duplican corridas.
 */
async function asegurarSincronizacionAutomatica(fuente: FuenteVentas, config: ConfigHiopos | null): Promise<void> {
  if (!syncAutomaticaHabilitada(fuente)) return
  if (fuente === 'hiopos' && !config?.exportationId) return
  if (await haySincronizacionPendiente(fuente)) return

  const [fila] = (await query(
    `SELECT TIMESTAMPDIFF(MINUTE, MAX(CASE WHEN tipo = 'rango' THEN iniciada_at END), NOW()) AS minutos,
            TIMESTAMPDIFF(MINUTE, MAX(CASE WHEN tipo = 'cambios' THEN iniciada_at END), NOW()) AS minutos_cambios,
            TIMESTAMPDIFF(HOUR, MAX(CASE WHEN tipo = 'rango' AND DATEDIFF(fecha_hasta, fecha_desde) >= ? THEN iniciada_at END), NOW()) AS horas_revision
     FROM ventas_sincronizaciones WHERE fuente = ? AND origen = 'automatica'`,
    [DIAS_REVISION - 1, fuente],
  )) as Array<{ minutos: number | null; minutos_cambios: number | null; horas_revision: number | null }>

  const intervalo = numeroEnv('VENTAS_SYNC_INTERVALO_MIN', INTERVALO_DEFAULT_MIN)
  const hoy = fechaArgentina(0)
  if (
    fila?.horas_revision === null ||
    fila?.horas_revision === undefined ||
    fila.horas_revision >= HORAS_ENTRE_REVISIONES
  ) {
    await insertarSincronizacion(fuente, 'automatica', 'rango', fechaArgentina(DIAS_REVISION), hoy, null)
  } else if (fila.minutos === null || fila.minutos >= intervalo) {
    await insertarSincronizacion(fuente, 'automatica', 'rango', fechaArgentina(1), hoy, null)
  }
  if (
    fuente === 'hiopos' &&
    config?.attrFechaModificado &&
    (fila?.minutos_cambios === null || fila?.minutos_cambios === undefined || fila.minutos_cambios >= intervalo)
  ) {
    await insertarSincronizacion(fuente, 'automatica', 'cambios', hoy, hoy, null)
  }
}

async function tomarCandado(fuente: FuenteVentas, segundos: number): Promise<boolean> {
  await query('INSERT IGNORE INTO ventas_fuentes_estado (fuente) VALUES (?)', [fuente])
  const resultado = (await query(
    `UPDATE ventas_fuentes_estado SET lock_hasta = DATE_ADD(NOW(), INTERVAL ? SECOND)
     WHERE fuente = ? AND (lock_hasta IS NULL OR lock_hasta < NOW())`,
    [segundos, fuente],
  )) as ResultSetHeader
  if (resultado.affectedRows === 0) return false

  if (fuente === 'bistrosoft') {
    const [estado] = (await query('SELECT ultima_llamada_ms FROM ventas_fuentes_estado WHERE fuente = ?', [
      fuente,
    ])) as Array<{ ultima_llamada_ms: number | string | null }>
    registrarUltimaLlamada(estado?.ultima_llamada_ms === null ? null : Number(estado?.ultima_llamada_ms))
  }
  return true
}

async function soltarCandado(fuente: FuenteVentas): Promise<void> {
  const ultima = fuente === 'bistrosoft' ? obtenerUltimaLlamada() : Date.now()
  await query(
    `UPDATE ventas_fuentes_estado
     SET lock_hasta = NULL, ultima_llamada_ms = GREATEST(COALESCE(ultima_llamada_ms, 0), ?)
     WHERE fuente = ?`,
    [ultima, fuente],
  )
}

function mensajeTramo(fuente: FuenteVentas, c: ContadoresImportacion): string | null {
  const partes: string[] = []
  if (c.diasConservados.length > 0) {
    partes.push(
      `${c.diasConservados.length === 1 ? 'Un día vino' : `${c.diasConservados.length} días vinieron`} vacío desde ${NOMBRE_FUENTE[fuente]} pero ya tenía ventas: se conservó lo importado (${c.diasConservados.join(', ')}).`,
    )
  }
  if (c.documentosFueraDeCobertura > 0) {
    partes.push(
      `${c.documentosFueraDeCobertura} documentos modificados son de días todavía no importados: entran al traer esos días.`,
    )
  }
  return partes.length ? partes.join(' ') : null
}

async function sumarTramo(
  fuente: FuenteVentas,
  id: number,
  hastaTramo: string | null,
  c: ContadoresImportacion,
): Promise<void> {
  await query(
    `UPDATE ventas_sincronizaciones
     SET paginas = paginas + 1, registros_recibidos = registros_recibidos + ?,
         registros_importados = registros_importados + ?, registros_observados = registros_observados + ?,
         registros_rechazados = registros_rechazados + ?, registros_reemplazados = registros_reemplazados + ?,
         dias_nuevos = dias_nuevos + ?, dias_actualizados = dias_actualizados + ?,
         proximo_dia = ${hastaTramo ? 'DATE_ADD(?, INTERVAL 1 DAY)' : 'proximo_dia'},
         mensaje = COALESCE(?, mensaje)
     WHERE id = ?`,
    [
      c.recibidos,
      c.importados,
      c.observados,
      c.rechazados,
      c.reemplazados,
      c.diasNuevos,
      c.diasActualizados,
      ...(hastaTramo ? [hastaTramo] : []),
      mensajeTramo(fuente, c),
      id,
    ],
  )
}

async function finalizar(fuente: FuenteVentas, id: number): Promise<void> {
  // "Con observaciones" si hubo datos de la fuente que no se pudieron leer o días conservados.
  // Un local todavía sin sucursal NO es un problema de la corrida: se avisa en Locales.
  const [fila] = (await query(
    'SELECT registros_rechazados AS rechazados, mensaje FROM ventas_sincronizaciones WHERE id = ?',
    [id],
  )) as Array<{ rechazados: number; mensaje: string | null }>
  const rechazados = Number(fila?.rechazados ?? 0)
  const avisos = [
    rechazados > 0
      ? `${rechazados} registros de ${NOMBRE_FUENTE[fuente]} no se pudieron leer (sin fecha, importe o número) y se omitieron.`
      : null,
    fila?.mensaje ?? null,
  ].filter(Boolean)

  await query(
    `UPDATE ventas_sincronizaciones
     SET estado = ?, mensaje = ?, proximo_dia = NULL, finalizada_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [avisos.length > 0 ? 'con_observaciones' : 'exitosa', avisos.length ? avisos.join(' ') : null, id],
  )
  // La integración volvió a andar: se limpia el último error que muestra la pantalla.
  if (fuente === 'hiopos') await guardarConfigHiopos({ ultimo_error: null })
}

async function marcarFallida(id: number, desde: string, dia: string | null, detalle: string): Promise<void> {
  let mensaje = detalle
  if (dia && dia > desde) {
    const [anio, mes, d] = dia.split('-')
    mensaje = `${detalle}. Quedaron importados los días anteriores al ${d}/${mes}/${anio}.`
  }
  await query(
    `UPDATE ventas_sincronizaciones
     SET estado = 'fallida', mensaje = ?, proximo_dia = NULL, finalizada_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [mensaje, id],
  )
}

interface Corrida {
  id: number
  tipo: TipoSincronizacion
  desde: string
  hasta: string
  dia: string | null
}

async function siguienteCorrida(fuente: FuenteVentas): Promise<Corrida | null> {
  const [corrida] = (await query(
    `SELECT id, tipo, DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS desde, DATE_FORMAT(fecha_hasta, '%Y-%m-%d') AS hasta,
            DATE_FORMAT(proximo_dia, '%Y-%m-%d') AS dia
     FROM ventas_sincronizaciones WHERE fuente = ? AND estado = 'en_curso' ORDER BY id LIMIT 1`,
    [fuente],
  )) as Corrida[]
  return corrida ?? null
}

/** Avanza las corridas de UNA fuente hasta `limite` (epoch ms). */
async function procesarFuente(
  fuente: FuenteVentas,
  limite: number,
  crearAutomatica: boolean,
  resultado: ResultadoProceso,
): Promise<void> {
  const segundos = Math.ceil(Math.max(limite - Date.now(), 0) / 1000) + MARGEN_CANDADO_S
  if (!(await tomarCandado(fuente, segundos))) return
  resultado.ejecutada = true
  const sesion = fuente === 'hiopos' ? new HioposSesion() : null

  try {
    const config = fuente === 'hiopos' ? await leerConfigHiopos() : null
    if (crearAutomatica) await asegurarSincronizacionAutomatica(fuente, config)

    while (Date.now() < limite) {
      const corrida = await siguienteCorrida(fuente)
      if (!corrida) break

      try {
        if (fuente === 'hiopos' && corrida.tipo === 'cambios') {
          const cambios = await importarCambios(
            sesion as HioposSesion,
            config as ConfigHiopos,
            corrida.id,
            fechaArgentina(0),
          )
          await sumarTramo(fuente, corrida.id, null, cambios)
          if (cambios.watermarkNuevo !== null && config) {
            config.watermarkMs = cambios.watermarkNuevo
            await guardarConfigHiopos({ watermark_ms: cambios.watermarkNuevo })
          }
          resultado.lineasImportadas += cambios.importados
          await finalizar(fuente, corrida.id)
          continue
        }

        if (!corrida.dia || corrida.dia > corrida.hasta) {
          await finalizar(fuente, corrida.id)
          continue
        }

        // Hiopos: varios días por consulta. Bistrosoft: un día por paso.
        const finTramo =
          fuente === 'hiopos'
            ? [sumarDias(corrida.dia, (config as ConfigHiopos).diasPorTramo - 1), corrida.hasta].sort()[0]
            : corrida.dia
        const contadores =
          fuente === 'hiopos'
            ? await importarTramo(sesion as HioposSesion, config as ConfigHiopos, corrida.id, corrida.dia, finTramo)
            : await importarDiaBistrosoft(corrida.id, corrida.dia)
        await sumarTramo(fuente, corrida.id, finTramo, contadores)
        resultado.diasProcesados += listarDias(corrida.dia, finTramo).length
        resultado.lineasImportadas += contadores.importados
        if (finTramo === corrida.hasta) await finalizar(fuente, corrida.id)
      } catch (err: unknown) {
        const detalle = err instanceof Error ? err.message : 'Error desconocido'
        if (err instanceof BistrosoftLimiteError) {
          // No es una falla: la corrida sigue en cola y la retoma la próxima invocación.
          await query('UPDATE ventas_sincronizaciones SET mensaje = ? WHERE id = ?', [
            'Bistrosoft pidió esperar un momento; se retoma sola.',
            corrida.id,
          ])
          break
        }
        console.error(`[Ventas] Sincronización ${NOMBRE_FUENTE[fuente]} #${corrida.id} fallida:`, detalle)
        if (err instanceof HioposError && err.tipo === 'red') {
          // Corte de red o timeout: se reintenta en la próxima invocación.
          await query('UPDATE ventas_sincronizaciones SET mensaje = ? WHERE id = ?', [
            `${detalle}. Se reintenta sola.`,
            corrida.id,
          ])
          break
        }
        await marcarFallida(corrida.id, corrida.desde, corrida.dia, detalle)
        if (fuente === 'hiopos') await guardarConfigHiopos({ ultimo_error: detalle })
        // Credenciales o configuración rotas: no tiene sentido seguir con otras corridas ahora.
        if (err instanceof HioposError && (err.tipo === 'credenciales' || err.tipo === 'configuracion')) break
      }
    }
  } finally {
    await sesion?.cerrar()
    await soltarCandado(fuente)
  }
}

/**
 * Avanza las corridas pendientes de todas las fuentes configuradas hasta agotar el
 * presupuesto de tiempo (VENTAS_SYNC_PRESUPUESTO_MS, 40 s por defecto; holgado respecto
 * del maxDuration de la función en Vercel).
 */
export async function procesarPendientes(opciones: { crearAutomatica: boolean }): Promise<ResultadoProceso> {
  const presupuesto = numeroEnv('VENTAS_SYNC_PRESUPUESTO_MS', PRESUPUESTO_DEFAULT_MS)
  const limite = Date.now() + presupuesto
  const resultado: ResultadoProceso = {
    ejecutada: false,
    diasProcesados: 0,
    lineasImportadas: 0,
    quedanPendientes: false,
  }

  for (const fuente of ORDEN_FUENTES) {
    if (!fuenteConfigurada(fuente) || Date.now() >= limite) continue
    await procesarFuente(fuente, limite, opciones.crearAutomatica, resultado)
  }

  resultado.quedanPendientes = await haySincronizacionPendiente()
  return resultado
}

export { reasignarLineasDeLocal } from './importacion'
