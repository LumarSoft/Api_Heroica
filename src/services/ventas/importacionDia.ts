import crypto from 'crypto'
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise'
import { getConnection, query } from '../../config/database'
import { obtenerTransaccionesDelDia } from './bistrosoftClient'
import { normalizarItemsBistrosoft } from './bistrosoftNormalizer'
import type { FuenteVentas, ItemCrudo, LineaVentaNormalizada } from './types'
import { vincularLocalesAutomaticamente } from './vinculacionLocales'

/**
 * Importación de UN día operativo: se consulta la fuente completa para ese día y se
 * reemplazan sus líneas en una transacción (ver migración 026). Nunca hay duplicados y
 * lo anulado/corregido en el POS se refleja en la próxima corrida.
 */

const LOTE_INSERT = 500
const CODIGO_SIN_LOCAL = '__sin_codigo__'

export interface ContadoresDia {
  paginas: number
  recibidos: number
  importados: number
  observados: number
  rechazados: number
  reemplazados: number
  /** true si el día no estaba importado; false si se actualizó uno que ya estaba. */
  diaNuevo: boolean
}

interface LocalExterno {
  id: number
  sucursalId: number | null
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

/** JSON con claves ordenadas: el mismo ítem produce siempre el mismo hash. */
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

/**
 * Hash por línea. Incluye el número de aparición porque un ticket puede tener dos
 * líneas idénticas legítimas (dos cafés cargados por separado).
 */
function calcularHashes(fuente: FuenteVentas, dia: string, items: ItemCrudo[]): string[] {
  const apariciones = new Map<string, number>()
  return items.map(item => {
    const base = `${fuente}|${dia}|${jsonEstable(item)}`
    const n = (apariciones.get(base) ?? 0) + 1
    apariciones.set(base, n)
    return crypto.createHash('sha256').update(`${base}|${n}`).digest('hex')
  })
}

async function resolverLocales(
  fuente: FuenteVentas,
  lineas: LineaVentaNormalizada[],
): Promise<Map<string, LocalExterno>> {
  const nombres = new Map<string, string | null>()
  for (const l of lineas) {
    const codigo = l.localCodigo ?? CODIGO_SIN_LOCAL
    if (!nombres.has(codigo) || (!nombres.get(codigo) && l.localNombre)) {
      nombres.set(codigo, l.localNombre ?? (codigo === CODIGO_SIN_LOCAL ? 'Local sin código' : null))
    }
  }
  if (nombres.size === 0) return new Map()

  const entradas = [...nombres.entries()]
  await query(
    `INSERT INTO ventas_locales_externos (fuente, codigo_externo, nombre_externo)
     VALUES ${entradas.map(() => '(?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE nombre_externo = COALESCE(VALUES(nombre_externo), nombre_externo)`,
    entradas.flatMap(([codigo, nombre]) => [fuente, codigo, nombre]),
  )

  // Un local nuevo cuyo nombre coincide con una sucursal queda vinculado antes de insertar.
  await vincularLocalesAutomaticamente()

  const filas = (await query(
    `SELECT id, codigo_externo, sucursal_id FROM ventas_locales_externos
     WHERE fuente = ? AND codigo_externo IN (${entradas.map(() => '?').join(', ')})`,
    [fuente, ...entradas.map(([codigo]) => codigo)],
  )) as Array<{ id: number; codigo_externo: string; sucursal_id: number | null }>

  return new Map(filas.map(f => [f.codigo_externo, { id: f.id, sucursalId: f.sucursal_id }]))
}

async function reemplazarDia(
  conn: PoolConnection,
  fuente: FuenteVentas,
  sincronizacionId: number,
  dia: string,
  lineas: LineaVentaNormalizada[],
  hashes: string[],
  locales: Map<string, LocalExterno>,
): Promise<{ reemplazados: number; observados: number }> {
  const [borrado] = await conn.execute<ResultSetHeader>('DELETE FROM ventas_lineas WHERE fuente = ? AND fecha = ?', [
    fuente,
    dia,
  ])

  let observados = 0
  for (let inicio = 0; inicio < lineas.length; inicio += LOTE_INSERT) {
    const lote = lineas.slice(inicio, inicio + LOTE_INSERT)
    const valores: unknown[] = []
    lote.forEach((l, i) => {
      const local = locales.get(l.localCodigo ?? CODIGO_SIN_LOCAL) ?? null
      const observada = !local?.sucursalId
      if (observada) observados++
      valores.push(
        fuente,
        sincronizacionId,
        hashes[inicio + i],
        local?.id ?? null,
        local?.sucursalId ?? null,
        l.transaccionId.slice(0, 100),
        dia,
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
        l.estadoOrigen?.slice(0, 100) ?? null,
        l.anulada ? 1 : 0,
        observada ? 1 : 0,
        JSON.stringify(l.raw),
      )
    })
    await conn.query(
      `INSERT INTO ventas_lineas
         (fuente, sincronizacion_id, linea_hash, local_externo_id, sucursal_id, transaccion_id, fecha, fecha_hora,
          tipo_linea, producto_codigo, producto_nombre, categoria, cantidad, precio_unitario, importe, descuento,
          medio_pago, canal, estado_origen, anulada, observada, raw)
       VALUES ${lote.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      valores,
    )
  }

  return { reemplazados: borrado.affectedRows, observados }
}

/** Importa un día operativo completo y devuelve sus contadores. */
export async function importarDia(fuente: FuenteVentas, sincronizacionId: number, dia: string): Promise<ContadoresDia> {
  const { items, paginas } = await obtenerTransaccionesDelDia(dia)
  const contadores: ContadoresDia = {
    paginas,
    recibidos: items.length,
    importados: 0,
    observados: 0,
    rechazados: 0,
    reemplazados: 0,
    diaNuevo: true,
  }

  const lineas: LineaVentaNormalizada[] = []
  const itemsValidos: ItemCrudo[] = []
  normalizarItemsBistrosoft(items).forEach((resultado, i) => {
    if (resultado.ok) {
      lineas.push(resultado.linea)
      itemsValidos.push(items[i])
    } else {
      contadores.rechazados++
    }
  })

  const locales = await resolverLocales(fuente, lineas)
  const hashes = calcularHashes(fuente, dia, itemsValidos)

  const conn = await getConnection()
  try {
    await conn.beginTransaction()
    const { reemplazados, observados } = await reemplazarDia(
      conn,
      fuente,
      sincronizacionId,
      dia,
      lineas,
      hashes,
      locales,
    )
    // Registro del día importado (aunque no haya tenido ventas): es la cobertura.
    // affectedRows 1 = día nuevo; 2 = ya estaba y se actualizó.
    const [registro] = await conn.execute<ResultSetHeader>(
      `INSERT INTO ventas_dias_sincronizados (fuente, fecha, sincronizacion_id, lineas, tickets)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sincronizacion_id = VALUES(sincronizacion_id), lineas = VALUES(lineas),
                               tickets = VALUES(tickets), actualizado_at = CURRENT_TIMESTAMP`,
      [
        fuente,
        dia,
        sincronizacionId,
        lineas.length,
        new Set(lineas.filter(l => l.tipoLinea === 'pago').map(l => l.transaccionId)).size,
      ],
    )
    contadores.diaNuevo = registro.affectedRows === 1
    await conn.commit()
    contadores.importados += lineas.length
    contadores.observados += observados
    contadores.reemplazados += reemplazados
  } catch (err: unknown) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  await query(
    `UPDATE ventas_locales_externos le
     JOIN (SELECT local_externo_id, MAX(COALESCE(fecha_hora, fecha)) AS ultima
           FROM ventas_lineas WHERE fuente = ? AND fecha = ? AND local_externo_id IS NOT NULL
           GROUP BY local_externo_id) x ON x.local_externo_id = le.id
     SET le.ultima_venta_at = GREATEST(COALESCE(le.ultima_venta_at, x.ultima), x.ultima)`,
    [fuente, dia],
  )

  return contadores
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
