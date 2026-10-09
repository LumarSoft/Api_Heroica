import type { ResultSetHeader } from 'mysql2/promise'
import { query } from '../../config/database'
import { hioposConfigurado, HioposError, HioposSesion } from './hioposClient'
import { guardarConfigHiopos, leerConfigHiopos, type ConfigHiopos } from './hioposMapeo'
import { importarCambios, importarTramo, listarDias, sumarDias, type ContadoresImportacion } from './importacion'
import type { FuenteVentas, OrigenSincronizacion, TipoSincronizacion } from './types'

/**
 * Orquestación de las sincronizaciones de ventas con Hiopos, pensada para Vercel
 * (serverless): no hay procesos de fondo. Una corrida queda "en curso" con
 * `proximo_dia` y cada invocación de `procesarPendientes` avanza tramos de días hasta
 * agotar su presupuesto de tiempo. La siguiente invocación retoma donde quedó.
 *
 * Quién invoca:
 *  - Vercel Cron → GET /api/ventas/cron (ver vercel.json) y node-cron fuera de Vercel.
 *  - La app al abrir el panel o la pantalla de integraciones → POST /api/ventas/integraciones/procesar.
 *
 * Cada invocación hace UN login al Bridge y su logout al terminar (la sesión de ICG
 * muere por inactividad, no conviene guardarla). Un candado con vencimiento en
 * `ventas_fuentes_estado` evita que dos invocaciones procesen a la vez.
 */

const FUENTE: FuenteVentas = 'hiopos'
/** Un año: la corrida avanza por tramos. */
export const MAX_DIAS_SINCRONIZACION = 366
const PRESUPUESTO_DEFAULT_MS = 40_000
const INTERVALO_DEFAULT_MIN = 30
const HORAS_ENTRE_REVISIONES = 20
const DIAS_REVISION = 7
const MARGEN_CANDADO_S = 120

export class SincronizacionEnCursoError extends Error {
  constructor() {
    super('Ya hay una sincronización de Hiopos en curso')
    this.name = 'SincronizacionEnCursoError'
  }
}

export interface ResultadoProceso {
  /** false si otra invocación tenía el candado o la integración no está configurada. */
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
  return process.env.VENTAS_SYNC_DISABLED !== 'true' && hioposConfigurado()
}

/** YYYY-MM-DD en Argentina (UTC-3), `diasAtras` días antes de hoy. */
export function fechaArgentina(diasAtras = 0): string {
  return new Date(Date.now() - 3 * 3_600_000 - diasAtras * 86_400_000).toISOString().slice(0, 10)
}

export async function haySincronizacionPendiente(): Promise<boolean> {
  const filas = (await query(`SELECT 1 FROM ventas_sincronizaciones WHERE fuente = ? AND estado = 'en_curso' LIMIT 1`, [
    FUENTE,
  ])) as unknown[]
  return filas.length > 0
}

async function insertarSincronizacion(
  origen: OrigenSincronizacion,
  tipo: TipoSincronizacion,
  desde: string,
  hasta: string,
  userId: number | null,
): Promise<number> {
  const resultado = (await query(
    `INSERT INTO ventas_sincronizaciones (fuente, origen, tipo, user_id, fecha_desde, fecha_hasta, proximo_dia, mensaje)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [FUENTE, origen, tipo, userId, desde, hasta, desde],
  )) as ResultSetHeader
  return resultado.insertId
}

/** Registra una corrida manual por rango. La procesan las invocaciones siguientes. */
export async function crearSincronizacionManual(opciones: {
  desde: string
  hasta: string
  userId: number | null
}): Promise<number> {
  const { desde, hasta, userId } = opciones
  if (!hioposConfigurado())
    throw new Error('Hiopos no está configurado en el servidor (HIOPOS_EMAIL / HIOPOS_PASSWORD)')
  const config = await leerConfigHiopos()
  if (!config.exportationId) throw new Error('Falta indicar el dashboard de exportación de HiOffice (exportationId)')

  const dias = listarDias(desde, hasta)
  if (dias.length === 0) throw new Error('El rango de fechas es inválido')
  if (dias.length > MAX_DIAS_SINCRONIZACION) {
    throw new Error(`El rango no puede superar ${MAX_DIAS_SINCRONIZACION} días`)
  }
  if (await haySincronizacionPendiente()) throw new SincronizacionEnCursoError()

  return insertarSincronizacion('manual', 'rango', desde, hasta, userId)
}

/**
 * Crea las corridas automáticas que correspondan, si no hay ninguna pendiente:
 *  - revisión de los últimos 7 días cada 20 h (correcciones tardías y días que faltaron);
 *  - si no, ayer + hoy cada VENTAS_SYNC_INTERVALO_MIN minutos (30 por defecto);
 *  - y, si el dashboard tiene filtro de Fecha Modificado, los cambios desde la marca de agua.
 * Se llama con el candado tomado, así dos invocaciones no crean corridas duplicadas.
 */
async function asegurarSincronizacionAutomatica(config: ConfigHiopos): Promise<void> {
  if (!syncAutomaticaHabilitada() || !config.exportationId) return
  if (await haySincronizacionPendiente()) return

  const [fila] = (await query(
    `SELECT TIMESTAMPDIFF(MINUTE, MAX(CASE WHEN tipo = 'rango' THEN iniciada_at END), NOW()) AS minutos,
            TIMESTAMPDIFF(MINUTE, MAX(CASE WHEN tipo = 'cambios' THEN iniciada_at END), NOW()) AS minutos_cambios,
            TIMESTAMPDIFF(HOUR, MAX(CASE WHEN tipo = 'rango' AND DATEDIFF(fecha_hasta, fecha_desde) >= ? THEN iniciada_at END), NOW()) AS horas_revision
     FROM ventas_sincronizaciones WHERE fuente = ? AND origen = 'automatica'`,
    [DIAS_REVISION - 1, FUENTE],
  )) as Array<{ minutos: number | null; minutos_cambios: number | null; horas_revision: number | null }>

  const intervalo = numeroEnv('VENTAS_SYNC_INTERVALO_MIN', INTERVALO_DEFAULT_MIN)
  const hoy = fechaArgentina(0)
  if (
    fila?.horas_revision === null ||
    fila?.horas_revision === undefined ||
    fila.horas_revision >= HORAS_ENTRE_REVISIONES
  ) {
    await insertarSincronizacion('automatica', 'rango', fechaArgentina(DIAS_REVISION), hoy, null)
  } else if (fila.minutos === null || fila.minutos >= intervalo) {
    await insertarSincronizacion('automatica', 'rango', fechaArgentina(1), hoy, null)
  }
  if (
    config.attrFechaModificado &&
    (fila?.minutos_cambios === null || fila?.minutos_cambios === undefined || fila.minutos_cambios >= intervalo)
  ) {
    await insertarSincronizacion('automatica', 'cambios', hoy, hoy, null)
  }
}

async function tomarCandado(segundos: number): Promise<boolean> {
  await query('INSERT IGNORE INTO ventas_fuentes_estado (fuente) VALUES (?)', [FUENTE])
  const resultado = (await query(
    `UPDATE ventas_fuentes_estado SET lock_hasta = DATE_ADD(NOW(), INTERVAL ? SECOND)
     WHERE fuente = ? AND (lock_hasta IS NULL OR lock_hasta < NOW())`,
    [segundos, FUENTE],
  )) as ResultSetHeader
  return resultado.affectedRows > 0
}

async function soltarCandado(): Promise<void> {
  await query('UPDATE ventas_fuentes_estado SET lock_hasta = NULL, ultima_llamada_ms = ? WHERE fuente = ?', [
    Date.now(),
    FUENTE,
  ])
}

function mensajeTramo(c: ContadoresImportacion): string | null {
  const partes: string[] = []
  if (c.diasConservados.length > 0) {
    partes.push(
      `${c.diasConservados.length === 1 ? 'Un día vino' : `${c.diasConservados.length} días vinieron`} vacío desde Hiopos pero ya tenía ventas: se conservó lo importado (${c.diasConservados.join(', ')}).`,
    )
  }
  if (c.documentosFueraDeCobertura > 0) {
    partes.push(
      `${c.documentosFueraDeCobertura} documentos modificados son de días todavía no importados: entran al traer esos días.`,
    )
  }
  return partes.length ? partes.join(' ') : null
}

async function sumarTramo(id: number, hastaTramo: string | null, c: ContadoresImportacion): Promise<void> {
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
      mensajeTramo(c),
      id,
    ],
  )
}

async function finalizar(id: number): Promise<void> {
  // "Con observaciones" si hubo filas de Hiopos que no se pudieron leer o días conservados.
  // Un local todavía sin sucursal NO es un problema de la corrida: se avisa en Locales.
  const [fila] = (await query(
    'SELECT registros_rechazados AS rechazados, mensaje FROM ventas_sincronizaciones WHERE id = ?',
    [id],
  )) as Array<{ rechazados: number; mensaje: string | null }>
  const rechazados = Number(fila?.rechazados ?? 0)
  const avisos = [
    rechazados > 0
      ? `${rechazados} filas de Hiopos no se pudieron leer (sin fecha, importe o número) y se omitieron.`
      : null,
    fila?.mensaje ?? null,
  ].filter(Boolean)

  await query(
    `UPDATE ventas_sincronizaciones
     SET estado = ?, mensaje = ?, proximo_dia = NULL, finalizada_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [avisos.length > 0 ? 'con_observaciones' : 'exitosa', avisos.length ? avisos.join(' ') : null, id],
  )
  // La integración volvió a andar: se limpia el último error que muestra la pantalla.
  await guardarConfigHiopos({ ultimo_error: null })
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

/**
 * Avanza las corridas pendientes (la más antigua primero) hasta agotar el presupuesto
 * de tiempo (VENTAS_SYNC_PRESUPUESTO_MS, 40 s por defecto; holgado respecto del
 * maxDuration de la función en Vercel).
 */
export async function procesarPendientes(opciones: { crearAutomatica: boolean }): Promise<ResultadoProceso> {
  const presupuesto = numeroEnv('VENTAS_SYNC_PRESUPUESTO_MS', PRESUPUESTO_DEFAULT_MS)
  const resultado: ResultadoProceso = {
    ejecutada: false,
    diasProcesados: 0,
    lineasImportadas: 0,
    quedanPendientes: false,
  }

  if (!hioposConfigurado()) return resultado
  if (!(await tomarCandado(Math.ceil(presupuesto / 1000) + MARGEN_CANDADO_S))) {
    resultado.quedanPendientes = await haySincronizacionPendiente()
    return resultado
  }
  resultado.ejecutada = true
  const sesion = new HioposSesion()

  try {
    const config = await leerConfigHiopos()
    if (opciones.crearAutomatica) await asegurarSincronizacionAutomatica(config)
    const inicio = Date.now()

    while (Date.now() - inicio < presupuesto) {
      const [corrida] = (await query(
        `SELECT id, tipo, DATE_FORMAT(fecha_desde, '%Y-%m-%d') AS desde, DATE_FORMAT(fecha_hasta, '%Y-%m-%d') AS hasta,
                DATE_FORMAT(proximo_dia, '%Y-%m-%d') AS dia
         FROM ventas_sincronizaciones WHERE fuente = ? AND estado = 'en_curso' ORDER BY id LIMIT 1`,
        [FUENTE],
      )) as Array<{ id: number; tipo: TipoSincronizacion; desde: string; hasta: string; dia: string | null }>
      if (!corrida) break

      try {
        if (corrida.tipo === 'cambios') {
          const cambios = await importarCambios(sesion, config, corrida.id, fechaArgentina(0))
          await sumarTramo(corrida.id, null, cambios)
          if (cambios.watermarkNuevo !== null) {
            config.watermarkMs = cambios.watermarkNuevo
            await guardarConfigHiopos({ watermark_ms: cambios.watermarkNuevo })
          }
          resultado.lineasImportadas += cambios.importados
          await finalizar(corrida.id)
          continue
        }

        if (!corrida.dia || corrida.dia > corrida.hasta) {
          await finalizar(corrida.id)
          continue
        }
        const finTramo = [sumarDias(corrida.dia, config.diasPorTramo - 1), corrida.hasta].sort()[0]
        const contadores = await importarTramo(sesion, config, corrida.id, corrida.dia, finTramo)
        await sumarTramo(corrida.id, finTramo, contadores)
        resultado.diasProcesados += listarDias(corrida.dia, finTramo).length
        resultado.lineasImportadas += contadores.importados
        if (finTramo === corrida.hasta) await finalizar(corrida.id)
      } catch (err: unknown) {
        const detalle = err instanceof Error ? err.message : 'Error desconocido'
        console.error(`[Ventas] Sincronización Hiopos #${corrida.id} fallida:`, detalle)
        if (err instanceof HioposError && err.tipo === 'red') {
          // Corte de red o timeout: no es culpa de los datos, se reintenta en la próxima invocación.
          await query('UPDATE ventas_sincronizaciones SET mensaje = ? WHERE id = ?', [
            `${detalle}. Se reintenta sola.`,
            corrida.id,
          ])
          break
        }
        await marcarFallida(corrida.id, corrida.desde, corrida.dia, detalle)
        await guardarConfigHiopos({ ultimo_error: detalle })
        // Credenciales o configuración rotas: no tiene sentido seguir con otras corridas ahora.
        if (err instanceof HioposError && (err.tipo === 'credenciales' || err.tipo === 'configuracion')) break
      }
    }
  } finally {
    await sesion.cerrar()
    await soltarCandado()
  }

  resultado.quedanPendientes = await haySincronizacionPendiente()
  return resultado
}

export { reasignarLineasDeLocal } from './importacion'
