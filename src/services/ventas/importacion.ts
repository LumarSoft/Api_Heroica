import crypto from 'crypto'
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise'
import { getConnection, query } from '../../config/database'
import { epochMsTexto, HioposError, type FiltroDashboard, type HioposSesion } from './hioposClient'
import { decodificarDocumentos } from './hioposDecoder'
import {
  detectarColumnas,
  detectarMapeo,
  guardarConfigHiopos,
  validarMapeo,
  type ConfigHiopos,
  type MapeoColumnas,
} from './hioposMapeo'
import { normalizarFilasHiopos } from './hioposNormalizer'
import type { FuenteVentas, ItemCrudo, LineaVentaNormalizada } from './types'
import { vincularLocalesAutomaticamente } from './vinculacionLocales'

/**
 * Importación de ventas de Hiopos, en dos modos (ver migraciones 026 y 027):
 *
 *  - Por RANGO de días: se exportan los documentos con Fecha Doc en el tramo y, en una
 *    transacción, se reemplazan las líneas de esos días. Nunca hay duplicados y lo
 *    corregido en HiOffice se refleja en la próxima corrida. Un día que antes tenía
 *    ventas y ahora viene vacío NO se borra (el Bridge "falla en silencio" con []).
 *  - Por CAMBIOS: documentos creados o modificados desde la marca de agua (filtro
 *    "Fecha Modificado"), reemplazados documento por documento. Solo se aplican a días
 *    ya importados, para no dejar días a medias en la cobertura.
 */

const FUENTE: FuenteVentas = 'hiopos'
const LOTE_INSERT = 500
const CODIGO_SIN_LOCAL = '__sin_local__'
/** Ventana de Fecha Doc para el modo cambios: documentos de hasta ~4 meses atrás. */
const DIAS_VENTANA_CAMBIOS = 120
/** Solapamiento al pedir cambios: re-procesar no duplica (se reemplaza por documento). */
const MARGEN_WATERMARK_MS = 5 * 60_000

export interface ContadoresImportacion {
  recibidos: number
  documentos: number
  importados: number
  observados: number
  rechazados: number
  reemplazados: number
  diasNuevos: number
  diasActualizados: number
  /** Días que ya tenían ventas y vinieron vacíos: se conservaron. */
  diasConservados: string[]
  /** Documentos de días todavía no importados (modo cambios): se omiten. */
  documentosFueraDeCobertura: number
  motivosRechazo: Record<string, number>
}

interface LocalExterno {
  id: number
  sucursalId: number | null
}

function contadoresVacios(): ContadoresImportacion {
  return {
    recibidos: 0,
    documentos: 0,
    importados: 0,
    observados: 0,
    rechazados: 0,
    reemplazados: 0,
    diasNuevos: 0,
    diasActualizados: 0,
    diasConservados: [],
    documentosFueraDeCobertura: 0,
    motivosRechazo: {},
  }
}

/** Días YYYY-MM-DD entre desde y hasta, inclusive. */
export function listarDias(desde: string, hasta: string): string[] {
  const dias: string[] = []
  const actual = new Date(`${desde}T12:00:00Z`)
  const fin = new Date(`${hasta}T12:00:00Z`)
  while (actual <= fin) {
    dias.push(actual.toISOString().slice(0, 10))
    actual.setUTCDate(actual.getUTCDate() + 1)
  }
  return dias
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** JSON con claves ordenadas: la misma línea produce siempre el mismo hash. */
function jsonEstable(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonEstable).join(',')}]`
  if (valor && typeof valor === 'object') {
    const obj = valor as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map(k => `${JSON.stringify(k)}:${jsonEstable(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(valor) ?? 'null'
}

/** Hash por línea; incluye el número de aparición dentro del documento (dos cafés iguales). */
function calcularHashes(lineas: LineaVentaNormalizada[]): string[] {
  const apariciones = new Map<string, number>()
  return lineas.map(l => {
    const base = `${FUENTE}|${l.transaccionId}|${l.tipoLinea}|${jsonEstable(l.raw)}|${l.importe}`
    const n = (apariciones.get(base) ?? 0) + 1
    apariciones.set(base, n)
    return crypto.createHash('sha256').update(`${base}|${n}`).digest('hex')
  })
}

async function resolverLocales(lineas: LineaVentaNormalizada[]): Promise<Map<string, LocalExterno>> {
  const nombres = new Map<string, string | null>()
  for (const l of lineas) {
    const codigo = l.localCodigo ?? CODIGO_SIN_LOCAL
    if (!nombres.has(codigo) || (!nombres.get(codigo) && l.localNombre)) {
      nombres.set(codigo, l.localNombre ?? (codigo === CODIGO_SIN_LOCAL ? 'Local sin informar' : null))
    }
  }
  if (nombres.size === 0) return new Map()

  const entradas = [...nombres.entries()]
  await query(
    `INSERT INTO ventas_locales_externos (fuente, codigo_externo, nombre_externo)
     VALUES ${entradas.map(() => '(?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE nombre_externo = COALESCE(VALUES(nombre_externo), nombre_externo)`,
    entradas.flatMap(([codigo, nombre]) => [FUENTE, codigo.slice(0, 100), nombre?.slice(0, 255) ?? null]),
  )

  // Un local nuevo cuyo nombre coincide con una sucursal queda vinculado antes de insertar.
  await vincularLocalesAutomaticamente()

  const filas = (await query(
    `SELECT id, codigo_externo, sucursal_id FROM ventas_locales_externos
     WHERE fuente = ? AND codigo_externo IN (${entradas.map(() => '?').join(', ')})`,
    [FUENTE, ...entradas.map(([codigo]) => codigo.slice(0, 100))],
  )) as Array<{ id: number; codigo_externo: string; sucursal_id: number | null }>

  return new Map(filas.map(f => [f.codigo_externo, { id: f.id, sucursalId: f.sucursal_id }]))
}

async function insertarLineas(
  conn: PoolConnection,
  sincronizacionId: number,
  lineas: LineaVentaNormalizada[],
  locales: Map<string, LocalExterno>,
): Promise<number> {
  const hashes = calcularHashes(lineas)
  let observados = 0
  for (let inicio = 0; inicio < lineas.length; inicio += LOTE_INSERT) {
    const lote = lineas.slice(inicio, inicio + LOTE_INSERT)
    const valores: unknown[] = []
    lote.forEach((l, i) => {
      const local = locales.get((l.localCodigo ?? CODIGO_SIN_LOCAL).slice(0, 100)) ?? null
      const observada = !local?.sucursalId
      if (observada) observados++
      valores.push(
        FUENTE,
        sincronizacionId,
        hashes[inicio + i],
        local?.id ?? null,
        local?.sucursalId ?? null,
        l.transaccionId.slice(0, 100),
        l.documento?.slice(0, 100) ?? null,
        l.tipoDocumento?.slice(0, 100) ?? null,
        l.fecha,
        l.fechaHora,
        l.tipoLinea,
        l.productoCodigo?.slice(0, 100) ?? null,
        l.productoNombre?.slice(0, 255) ?? null,
        l.categoria?.slice(0, 150) ?? null,
        l.cantidad,
        l.precioUnitario,
        l.importe,
        l.descuento,
        l.medioPago?.slice(0, 150) ?? null,
        l.canal?.slice(0, 150) ?? null,
        l.vendedor?.slice(0, 150) ?? null,
        l.caja?.slice(0, 100) ?? null,
        l.estadoOrigen?.slice(0, 100) ?? null,
        l.anulada ? 1 : 0,
        observada ? 1 : 0,
        JSON.stringify(l.raw),
      )
    })
    await conn.query(
      `INSERT INTO ventas_lineas
         (fuente, sincronizacion_id, linea_hash, local_externo_id, sucursal_id, transaccion_id, documento, tipo_documento,
          fecha, fecha_hora, tipo_linea, producto_codigo, producto_nombre, categoria, cantidad, precio_unitario, importe,
          descuento, medio_pago, canal, vendedor, caja, estado_origen, anulada, observada, raw)
       VALUES ${lote.map(() => `(${new Array(26).fill('?').join(', ')})`).join(', ')}`,
      valores,
    )
  }
  return observados
}

async function borrarDocumentos(conn: PoolConnection, transacciones: string[]): Promise<number> {
  let borrados = 0
  for (let i = 0; i < transacciones.length; i += LOTE_INSERT) {
    const lote = transacciones.slice(i, i + LOTE_INSERT)
    const [r] = await conn.query<ResultSetHeader>(
      `DELETE FROM ventas_lineas WHERE fuente = ? AND transaccion_id IN (${lote.map(() => '?').join(', ')})`,
      [FUENTE, ...lote],
    )
    borrados += r.affectedRows
  }
  return borrados
}

/** Recalcula líneas y tickets de los días tocados (cobertura). */
async function recontarDias(
  conn: PoolConnection,
  dias: string[],
  sincronizacionId: number,
): Promise<{ nuevos: number; actualizados: number }> {
  let nuevos = 0
  let actualizados = 0
  for (const dia of dias) {
    const [[conteo]] = (await conn.query(
      `SELECT COUNT(*) AS lineas, COUNT(DISTINCT CASE WHEN tipo_linea = 'pago' THEN transaccion_id END) AS tickets
       FROM ventas_lineas WHERE fuente = ? AND fecha = ?`,
      [FUENTE, dia],
    )) as unknown as [[{ lineas: number; tickets: number }]]
    const [registro] = await conn.query<ResultSetHeader>(
      `INSERT INTO ventas_dias_sincronizados (fuente, fecha, sincronizacion_id, lineas, tickets)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sincronizacion_id = VALUES(sincronizacion_id), lineas = VALUES(lineas),
                               tickets = VALUES(tickets), actualizado_at = CURRENT_TIMESTAMP`,
      [FUENTE, dia, sincronizacionId, Number(conteo.lineas), Number(conteo.tickets)],
    )
    // affectedRows 1 = día nuevo; 2 = ya estaba y se actualizó.
    if (registro.affectedRows === 1) nuevos++
    else actualizados++
  }
  return { nuevos, actualizados }
}

async function actualizarUltimaVenta(dias: string[]): Promise<void> {
  if (dias.length === 0) return
  await query(
    `UPDATE ventas_locales_externos le
     JOIN (SELECT local_externo_id, MAX(COALESCE(fecha_hora, fecha)) AS ultima
           FROM ventas_lineas WHERE fuente = ? AND fecha IN (${dias.map(() => '?').join(', ')}) AND local_externo_id IS NOT NULL
           GROUP BY local_externo_id) x ON x.local_externo_id = le.id
     SET le.ultima_venta_at = GREATEST(COALESCE(le.ultima_venta_at, x.ultima), x.ultima)`,
    [FUENTE, ...dias],
  )
}

/**
 * Si todavía no hay mapeo guardado, se detecta por nombre de columna con lo que vino
 * y se guarda (se puede corregir en pantalla). Falla si no alcanza para importar.
 */
async function asegurarMapeo(config: ConfigHiopos, filas: ItemCrudo[]): Promise<MapeoColumnas> {
  let mapeo = config.mapeo
  if (validarMapeo(mapeo).length > 0 && filas.length > 0) {
    const columnas = detectarColumnas(filas)
    const detectado = { ...detectarMapeo(columnas.map(c => c.nombre)), ...mapeo }
    if (validarMapeo(detectado).length === 0) {
      mapeo = detectado
      config.mapeo = detectado
      config.columnasDetectadas = columnas
      await guardarConfigHiopos({ mapeo_columnas: detectado, columnas_detectadas: columnas })
    }
  }
  const faltantes = validarMapeo(mapeo)
  if (faltantes.length > 0 && filas.length > 0) {
    throw new HioposError(
      `El mapeo de columnas está incompleto: ${faltantes.join('; ')}. Revisalo en Integraciones.`,
      'configuracion',
    )
  }
  return mapeo
}

async function exportar(
  sesion: HioposSesion,
  config: ConfigHiopos,
  startDate: string,
  endDate: string,
  filters: FiltroDashboard[],
): Promise<ItemCrudo[]> {
  if (!config.exportationId) {
    throw new HioposError(
      'Falta el exportationId del dashboard de HiOffice (Integraciones o HIOPOS_EXPORTATION_ID)',
      'configuracion',
    )
  }
  const resultado = await sesion.launch({ exportationId: config.exportationId, startDate, endDate, filters })
  if (resultado.bodyVacio) {
    throw new HioposError(
      'Hiopos respondió vacío (0 bytes): el dashboard no tiene alguno de los filtros enviados o cambió su configuración. Corré el diagnóstico en Integraciones.',
      'configuracion',
    )
  }
  return decodificarDocumentos(resultado.documentos).filas
}

function contarRechazos(contadores: ContadoresImportacion, rechazadas: Array<{ motivo: string }>): void {
  contadores.rechazados += rechazadas.length
  for (const r of rechazadas) contadores.motivosRechazo[r.motivo] = (contadores.motivosRechazo[r.motivo] ?? 0) + 1
}

/** Importa un tramo de días completos [desde, hasta]. */
export async function importarTramo(
  sesion: HioposSesion,
  config: ConfigHiopos,
  sincronizacionId: number,
  desde: string,
  hasta: string,
): Promise<ContadoresImportacion> {
  const contadores = contadoresVacios()
  // endDate +1 día y se filtra acá: así da igual si el Bridge lo toma inclusivo o exclusivo.
  const filas = await exportar(sesion, config, desde, sumarDias(hasta, 1), [])
  contadores.recibidos = filas.length

  const mapeo = await asegurarMapeo(config, filas)
  const normalizado =
    filas.length > 0 ? normalizarFilasHiopos(filas, mapeo) : { lineas: [], rechazadas: [], documentos: 0 }
  contarRechazos(contadores, normalizado.rechazadas)
  const lineas = normalizado.lineas.filter(l => l.fecha >= desde && l.fecha <= hasta)

  const dias = listarDias(desde, hasta)
  const conDatos = new Set(lineas.map(l => l.fecha))
  const previos = (await query(
    `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, COUNT(*) AS lineas FROM ventas_lineas
     WHERE fuente = ? AND fecha BETWEEN ? AND ? GROUP BY fecha`,
    [FUENTE, desde, hasta],
  )) as Array<{ fecha: string; lineas: number }>
  const conLineasPrevias = new Set(previos.filter(p => Number(p.lineas) > 0).map(p => p.fecha))
  contadores.diasConservados = dias.filter(d => !conDatos.has(d) && conLineasPrevias.has(d))
  const aReemplazar = dias.filter(d => !contadores.diasConservados.includes(d))

  const locales = await resolverLocales(lineas)
  const transacciones = [...new Set(lineas.map(l => l.transaccionId.slice(0, 100)))]
  contadores.documentos = transacciones.length

  const conn = await getConnection()
  try {
    await conn.beginTransaction()
    if (aReemplazar.length > 0) {
      const [borrado] = await conn.query<ResultSetHeader>(
        `DELETE FROM ventas_lineas WHERE fuente = ? AND fecha IN (${aReemplazar.map(() => '?').join(', ')})`,
        [FUENTE, ...aReemplazar],
      )
      contadores.reemplazados += borrado.affectedRows
    }
    // Documentos a los que les cambiaron la fecha: se borran de donde estaban.
    contadores.reemplazados += await borrarDocumentos(conn, transacciones)
    contadores.observados = await insertarLineas(conn, sincronizacionId, lineas, locales)
    const otrosDias = [...new Set(lineas.map(l => l.fecha))].filter(d => !aReemplazar.includes(d))
    const { nuevos, actualizados } = await recontarDias(conn, [...aReemplazar, ...otrosDias], sincronizacionId)
    contadores.diasNuevos = nuevos
    contadores.diasActualizados = actualizados
    await conn.commit()
  } catch (err: unknown) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  contadores.importados = lineas.length
  await actualizarUltimaVenta([...conDatos])
  return contadores
}

/** Filtro "Fecha Modificado" con la plantilla del dashboard (solo cambian value y value2). */
function filtroModificado(config: ConfigHiopos, desdeMs: number, hastaMs: number): FiltroDashboard {
  const plantilla = config.filtrosDashboard.find(f => f.attributeId === config.attrFechaModificado)
  return {
    attributeId: config.attrFechaModificado as number,
    arithmeticOperator: plantilla?.arithmeticOperator ?? 'BETWEEN',
    type: plantilla?.type ?? 'Datetime',
    value: epochMsTexto(desdeMs),
    value2: epochMsTexto(hastaMs),
  }
}

export interface ResultadoCambios extends ContadoresImportacion {
  watermarkNuevo: number | null
  desdeMs: number
  hastaMs: number
}

/** Documentos creados/modificados desde la marca de agua. */
export async function importarCambios(
  sesion: HioposSesion,
  config: ConfigHiopos,
  sincronizacionId: number,
  hoy: string,
): Promise<ResultadoCambios> {
  if (!config.attrFechaModificado) {
    throw new HioposError('No está configurado el filtro "Fecha Modificado" del dashboard', 'configuracion')
  }
  const hastaMs = Date.now()
  const desdeMs = Math.max((config.watermarkMs ?? hastaMs - 24 * 3_600_000) - MARGEN_WATERMARK_MS, 0)
  const contadores = contadoresVacios()

  // Rango de Fecha Doc amplio + filtro de modificación angosto (manual §3.4).
  const filas = await exportar(sesion, config, sumarDias(hoy, -DIAS_VENTANA_CAMBIOS), sumarDias(hoy, 1), [
    filtroModificado(config, desdeMs, hastaMs),
  ])
  contadores.recibidos = filas.length
  const mapeo = await asegurarMapeo(config, filas)
  const normalizado =
    filas.length > 0 ? normalizarFilasHiopos(filas, mapeo) : { lineas: [], rechazadas: [], documentos: 0 }
  contarRechazos(contadores, normalizado.rechazadas)

  const modificados = normalizado.lineas
    .map(l => l.modificadoMs)
    .filter((m): m is number => m !== null && m <= hastaMs + 60_000)
  // Marca de agua: el máximo "Fecha Modificado" recibido (no now(), para no perder lo que entró
  // mientras corría). Si el export no trae esa columna, el inicio de la consulta.
  const watermarkNuevo = modificados.length > 0 ? Math.max(...modificados, config.watermarkMs ?? 0) : hastaMs - 60_000

  const fechas = [...new Set(normalizado.lineas.map(l => l.fecha))]
  const cubiertos = new Set<string>()
  if (fechas.length > 0) {
    const filasCubiertas = (await query(
      `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha FROM ventas_dias_sincronizados
       WHERE fuente = ? AND fecha IN (${fechas.map(() => '?').join(', ')})`,
      [FUENTE, ...fechas],
    )) as Array<{ fecha: string }>
    for (const f of filasCubiertas) cubiertos.add(f.fecha)
  }
  const lineas = normalizado.lineas.filter(l => cubiertos.has(l.fecha))
  contadores.documentosFueraDeCobertura = new Set(
    normalizado.lineas.filter(l => !cubiertos.has(l.fecha)).map(l => l.transaccionId),
  ).size

  if (lineas.length > 0) {
    const locales = await resolverLocales(lineas)
    const transacciones = [...new Set(lineas.map(l => l.transaccionId.slice(0, 100)))]
    contadores.documentos = transacciones.length
    const conn = await getConnection()
    try {
      await conn.beginTransaction()
      contadores.reemplazados = await borrarDocumentos(conn, transacciones)
      contadores.observados = await insertarLineas(conn, sincronizacionId, lineas, locales)
      const { actualizados } = await recontarDias(conn, [...new Set(lineas.map(l => l.fecha))], sincronizacionId)
      contadores.diasActualizados = actualizados
      await conn.commit()
    } catch (err: unknown) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
    contadores.importados = lineas.length
    await actualizarUltimaVenta([...new Set(lineas.map(l => l.fecha))])
  }

  return { ...contadores, watermarkNuevo, desdeMs, hastaMs }
}

/**
 * Cuando se asigna (o cambia) la sucursal de un local externo, sus líneas ya
 * importadas pasan a la nueva sucursal sin esperar a la próxima sincronización.
 */
export async function reasignarLineasDeLocal(localExternoId: number, sucursalId: number | null): Promise<number> {
  const resultado = (await query('UPDATE ventas_lineas SET sucursal_id = ?, observada = ? WHERE local_externo_id = ?', [
    sucursalId,
    sucursalId ? 0 : 1,
    localExternoId,
  ])) as ResultSetHeader
  return resultado.affectedRows
}
