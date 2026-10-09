import ExcelJS from 'exceljs'
import { query } from '../../config/database'
import {
  construirWhereVentas,
  FiltroInvalidoError,
  mismoPeriodoAnioAnterior,
  periodoAnterior,
  type FiltrosVentas,
  type PerspectivaLineas,
} from '../../utils/ventasFiltros'

/**
 * Constructor de reportes de ventas: el usuario elige cómo agrupar (hasta 3
 * dimensiones), qué medir y con qué filtros; opcionalmente compara contra otro
 * período. Todo el SQL sale de listas blancas: nada del cliente se concatena.
 */

export type Dimension =
  | 'sucursal'
  | 'dia'
  | 'semana'
  | 'mes'
  | 'anio'
  | 'dia_semana'
  | 'hora'
  | 'producto'
  | 'categoria'
  | 'medio_pago'
  | 'canal'
  | 'vendedor'
  | 'caja'
  | 'tipo_documento'

export type Metrica =
  | 'facturacion'
  | 'unidades'
  | 'tickets'
  | 'ticket_promedio'
  | 'descuentos'
  | 'precio_promedio'
  | 'unidades_por_ticket'
  | 'participacion'
  | 'promedio_diario'

export type Comparacion = 'ninguna' | 'periodo_anterior' | 'anio_anterior'

export type PeriodoRelativo =
  | 'hoy'
  | 'ayer'
  | 'ultimos_7'
  | 'ultimos_30'
  | 'semana_actual'
  | 'semana_anterior'
  | 'mes_actual'
  | 'mes_anterior'
  | 'anio_actual'

export interface ConfigReporte {
  dimensiones: Dimension[]
  metricas: Metrica[]
  comparacion: Comparacion
  orden: { campo: string; direccion: 'asc' | 'desc' }
  limite: number
  /** Período guardado con el reporte: relativo (se recalcula cada vez) o fijo. */
  periodo: { tipo: 'relativo'; clave: PeriodoRelativo } | { tipo: 'fijo'; desde: string; hasta: string }
  filtros: {
    sucursal_ids?: number[]
    categoria?: string
    medio_pago?: string
    canal?: string
    producto?: string
    vendedor?: string
    caja?: string
  }
}

interface DefDimension {
  etiqueta: string
  sql: string
  /** true: el valor depende del calendario (no se puede comparar fila a fila con otro período). */
  temporal?: boolean
  /** Solo existe en el encabezado del ticket (medio de pago). */
  soloPago?: boolean
  /** Agrupa productos: se excluyen las líneas de descuento. */
  deProducto?: boolean
}

export const DIMENSIONES: Record<Dimension, DefDimension> = {
  sucursal: { etiqueta: 'Sucursal', sql: "COALESCE(s.nombre, 'Sin sucursal asignada')" },
  dia: { etiqueta: 'Día', sql: "DATE_FORMAT(l.fecha, '%Y-%m-%d')", temporal: true },
  semana: {
    etiqueta: 'Semana',
    sql: "DATE_FORMAT(DATE_SUB(l.fecha, INTERVAL WEEKDAY(l.fecha) DAY), '%Y-%m-%d')",
    temporal: true,
  },
  mes: { etiqueta: 'Mes', sql: "DATE_FORMAT(l.fecha, '%Y-%m')", temporal: true },
  anio: { etiqueta: 'Año', sql: "DATE_FORMAT(l.fecha, '%Y')", temporal: true },
  dia_semana: { etiqueta: 'Día de la semana', sql: 'WEEKDAY(l.fecha)' },
  hora: { etiqueta: 'Hora', sql: 'HOUR(l.fecha_hora)' },
  producto: { etiqueta: 'Producto', sql: "COALESCE(l.producto_nombre, 'Sin nombre')", deProducto: true },
  categoria: { etiqueta: 'Familia / categoría', sql: "COALESCE(l.categoria, 'Sin categoría')", deProducto: true },
  medio_pago: { etiqueta: 'Medio de pago', sql: "COALESCE(l.medio_pago, 'Sin informar')", soloPago: true },
  canal: { etiqueta: 'Canal', sql: "COALESCE(l.canal, 'Sin informar')" },
  vendedor: { etiqueta: 'Vendedor', sql: "COALESCE(l.vendedor, 'Sin informar')" },
  caja: { etiqueta: 'Caja', sql: "COALESCE(l.caja, 'Sin informar')" },
  tipo_documento: { etiqueta: 'Tipo de documento', sql: "COALESCE(l.tipo_documento, 'Sin informar')" },
}

interface DefMetrica {
  etiqueta: string
  formato: 'moneda' | 'numero' | 'porcentaje'
  /** Necesita datos de líneas de producto (no existe agrupando por medio de pago). */
  deProducto?: boolean
}

export const METRICAS: Record<Metrica, DefMetrica> = {
  facturacion: { etiqueta: 'Facturación', formato: 'moneda' },
  unidades: { etiqueta: 'Unidades', formato: 'numero', deProducto: true },
  tickets: { etiqueta: 'Tickets', formato: 'numero' },
  ticket_promedio: { etiqueta: 'Ticket promedio', formato: 'moneda' },
  descuentos: { etiqueta: 'Descuentos', formato: 'moneda', deProducto: true },
  precio_promedio: { etiqueta: 'Precio promedio', formato: 'moneda', deProducto: true },
  unidades_por_ticket: { etiqueta: 'Unidades por ticket', formato: 'numero', deProducto: true },
  participacion: { etiqueta: '% del total', formato: 'porcentaje' },
  promedio_diario: { etiqueta: 'Promedio por día', formato: 'moneda' },
}

const NOMBRES_DIA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const LIMITE_DEFAULT = 500
const LIMITE_MAX = 5000
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const PERIODOS: PeriodoRelativo[] = [
  'hoy',
  'ayer',
  'ultimos_7',
  'ultimos_30',
  'semana_actual',
  'semana_anterior',
  'mes_actual',
  'mes_anterior',
  'anio_actual',
]

const num = (v: unknown): number => Number(v ?? 0) || 0
const redondear = (v: number, dec = 2) => Math.round(v * 10 ** dec) / 10 ** dec

function texto(v: unknown, max = 150): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

/** Valida y normaliza la configuración que manda el front (o la guardada). */
export function validarConfigReporte(crudo: unknown): ConfigReporte {
  const c = (crudo ?? {}) as Record<string, unknown>
  const dimensiones = (Array.isArray(c.dimensiones) ? c.dimensiones : [])
    .filter((d): d is Dimension => typeof d === 'string' && d in DIMENSIONES)
    .filter((d, i, arr) => arr.indexOf(d) === i)
  if (dimensiones.length > 3) throw new FiltroInvalidoError('Se puede agrupar por hasta 3 dimensiones')

  const metricas = (Array.isArray(c.metricas) ? c.metricas : ['facturacion', 'tickets'])
    .filter((m): m is Metrica => typeof m === 'string' && m in METRICAS)
    .filter((m, i, arr) => arr.indexOf(m) === i)
  if (metricas.length === 0) throw new FiltroInvalidoError('Elegí al menos una métrica')

  const comparacion: Comparacion =
    c.comparacion === 'periodo_anterior' || c.comparacion === 'anio_anterior' ? c.comparacion : 'ninguna'

  const ordenCrudo = (c.orden ?? {}) as Record<string, unknown>
  const campoOrden =
    typeof ordenCrudo.campo === 'string' && (ordenCrudo.campo in METRICAS || ordenCrudo.campo in DIMENSIONES)
      ? ordenCrudo.campo
      : dimensiones.some(d => DIMENSIONES[d].temporal)
        ? dimensiones.find(d => DIMENSIONES[d].temporal)!
        : metricas[0]
  const direccion =
    ordenCrudo.direccion === 'asc'
      ? 'asc'
      : ordenCrudo.direccion === 'desc'
        ? 'desc'
        : campoOrden in DIMENSIONES
          ? 'asc'
          : 'desc'

  const limite = Math.min(LIMITE_MAX, Math.max(1, Math.floor(Number(c.limite) || LIMITE_DEFAULT)))

  const p = (c.periodo ?? {}) as Record<string, unknown>
  let periodo: ConfigReporte['periodo']
  if (
    p.tipo === 'fijo' &&
    typeof p.desde === 'string' &&
    typeof p.hasta === 'string' &&
    FECHA_RE.test(p.desde) &&
    FECHA_RE.test(p.hasta)
  ) {
    periodo = { tipo: 'fijo', desde: p.desde, hasta: p.hasta }
  } else {
    periodo = {
      tipo: 'relativo',
      clave: PERIODOS.includes(p.clave as PeriodoRelativo) ? (p.clave as PeriodoRelativo) : 'ultimos_30',
    }
  }

  const f = (c.filtros ?? {}) as Record<string, unknown>
  const sucursalIds = (Array.isArray(f.sucursal_ids) ? f.sucursal_ids : [])
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
  return {
    dimensiones,
    metricas,
    comparacion,
    orden: { campo: campoOrden, direccion },
    limite,
    periodo,
    filtros: {
      sucursal_ids: sucursalIds,
      categoria: texto(f.categoria),
      medio_pago: texto(f.medio_pago),
      canal: texto(f.canal),
      producto: texto(f.producto),
      vendedor: texto(f.vendedor),
      caja: texto(f.caja),
    },
  }
}

function hoyArgentina(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Fechas concretas de un período relativo (calculadas en hora Argentina). */
export function resolverPeriodo(
  periodo: ConfigReporte['periodo'],
  hoy = hoyArgentina(),
): { desde: string; hasta: string } {
  if (periodo.tipo === 'fijo') return { desde: periodo.desde, hasta: periodo.hasta }
  const d = new Date(`${hoy}T12:00:00Z`)
  const lunes = sumarDias(hoy, -((d.getUTCDay() + 6) % 7))
  const inicioMes = `${hoy.slice(0, 8)}01`
  switch (periodo.clave) {
    case 'hoy':
      return { desde: hoy, hasta: hoy }
    case 'ayer':
      return { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) }
    case 'ultimos_7':
      return { desde: sumarDias(hoy, -6), hasta: hoy }
    case 'semana_actual':
      return { desde: lunes, hasta: hoy }
    case 'semana_anterior':
      return { desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1) }
    case 'mes_actual':
      return { desde: inicioMes, hasta: hoy }
    case 'mes_anterior': {
      const fin = sumarDias(inicioMes, -1)
      return { desde: `${fin.slice(0, 8)}01`, hasta: fin }
    }
    case 'anio_actual':
      return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy }
    default:
      return { desde: sumarDias(hoy, -29), hasta: hoy }
  }
}

export interface ColumnaReporte {
  clave: string
  etiqueta: string
  tipo: 'dimension' | 'moneda' | 'numero' | 'porcentaje'
}

export interface FilaReporte {
  dimensiones: Record<string, string>
  valores: Record<string, number | null>
  comparado?: Record<string, number | null>
  /** Variación % contra el período comparado (null si no hay base). */
  variacion?: Record<string, number | null>
}

export interface ResultadoReporte {
  columnas: ColumnaReporte[]
  filas: FilaReporte[]
  totales: Record<string, number | null>
  totalesComparados: Record<string, number | null> | null
  variacionTotales: Record<string, number | null> | null
  periodo: { desde: string; hasta: string }
  periodoComparado: { desde: string; hasta: string } | null
  truncado: boolean
  avisos: string[]
}

function etiquetaDimension(dimension: Dimension, valor: unknown): string {
  if (valor === null || valor === undefined) return dimension === 'hora' ? 'Sin hora' : 'Sin informar'
  if (dimension === 'dia_semana') return NOMBRES_DIA[num(valor)] ?? String(valor)
  if (dimension === 'hora') return `${String(num(valor)).padStart(2, '0')}:00`
  return String(valor)
}

interface Agregado {
  facturacion: number
  unidades: number
  tickets: number
  descuentos: number
  jornadas: number
}

function derivar(
  a: Agregado,
  totalFacturacion: number,
  metricas: Metrica[],
  conProducto: boolean,
): Record<string, number | null> {
  const valores: Record<string, number | null> = {}
  for (const m of metricas) {
    if (METRICAS[m].deProducto && !conProducto) {
      valores[m] = null
      continue
    }
    switch (m) {
      case 'facturacion':
        valores[m] = redondear(a.facturacion)
        break
      case 'unidades':
        valores[m] = redondear(a.unidades, 3)
        break
      case 'tickets':
        valores[m] = a.tickets
        break
      case 'ticket_promedio':
        valores[m] = a.tickets > 0 ? redondear(a.facturacion / a.tickets) : null
        break
      case 'descuentos':
        valores[m] = redondear(a.descuentos)
        break
      case 'precio_promedio':
        valores[m] = a.unidades !== 0 ? redondear(a.facturacion / a.unidades) : null
        break
      case 'unidades_por_ticket':
        valores[m] = a.tickets > 0 ? redondear(a.unidades / a.tickets) : null
        break
      case 'participacion':
        valores[m] = totalFacturacion !== 0 ? redondear((a.facturacion / totalFacturacion) * 100) : null
        break
      case 'promedio_diario':
        valores[m] = a.jornadas > 0 ? redondear(a.facturacion / a.jornadas) : null
        break
    }
  }
  return valores
}

function variacion(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || anterior === 0) return null
  return redondear(((actual - anterior) / Math.abs(anterior)) * 100, 1)
}

async function consultar(
  filtros: FiltrosVentas,
  dimensiones: Dimension[],
  perspectiva: PerspectivaLineas,
  limite: number | null,
  ordenSql: string | null,
) {
  const { where, params } = construirWhereVentas(filtros, perspectiva)
  const selectDims = dimensiones.map((d, i) => `${DIMENSIONES[d].sql} AS d${i}`)
  const groupBy = dimensiones.map((_, i) => `d${i}`)
  const sql = `
    SELECT ${[
      ...selectDims,
      'SUM(l.importe) AS facturacion',
      'SUM(l.cantidad) AS unidades',
      'COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets',
      'SUM(l.descuento) AS descuentos',
      'COUNT(DISTINCT l.fecha) AS jornadas',
    ].join(', ')}
    FROM ventas_lineas l LEFT JOIN sucursales s ON s.id = l.sucursal_id
    WHERE ${where}
    ${groupBy.length ? `GROUP BY ${groupBy.join(', ')}` : ''}
    ${ordenSql ? `ORDER BY ${ordenSql}` : ''}
    ${limite ? `LIMIT ${limite}` : ''}`
  return (await query(sql, params)) as Array<Record<string, unknown>>
}

function agregado(f: Record<string, unknown>): Agregado {
  return {
    facturacion: num(f.facturacion),
    unidades: num(f.unidades),
    tickets: num(f.tickets),
    descuentos: num(f.descuentos),
    jornadas: num(f.jornadas),
  }
}

export async function ejecutarReporte(filtros: FiltrosVentas, config: ConfigReporte): Promise<ResultadoReporte> {
  const { dimensiones, metricas } = config
  const avisos: string[] = []
  const soloPago = dimensiones.some(d => DIMENSIONES[d].soloPago)
  const deProducto = dimensiones.some(d => DIMENSIONES[d].deProducto)
  if (soloPago && deProducto) {
    throw new FiltroInvalidoError(
      'El medio de pago se registra por ticket: no se puede cruzar con producto o categoría',
    )
  }
  const perspectiva: PerspectivaLineas = soloPago ? 'pago' : deProducto ? 'producto' : 'venta'
  if (soloPago && metricas.some(m => METRICAS[m].deProducto)) {
    avisos.push('Agrupando por medio de pago no hay unidades ni descuentos: esas columnas quedan vacías.')
  }

  // ORDER BY seguro: alias de dimensión o expresión de métrica de la lista blanca.
  // (MySQL no acepta alias de agregados dentro de expresiones en ORDER BY: van las funciones.)
  const FACT = 'SUM(l.importe)'
  const UNID = 'SUM(l.cantidad)'
  const TICK = 'COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id)'
  const ORDEN_METRICA: Record<Metrica, string> = {
    facturacion: FACT,
    unidades: UNID,
    tickets: TICK,
    descuentos: 'SUM(l.descuento)',
    participacion: FACT,
    ticket_promedio: `${FACT} / NULLIF(${TICK}, 0)`,
    precio_promedio: `${FACT} / NULLIF(${UNID}, 0)`,
    unidades_por_ticket: `${UNID} / NULLIF(${TICK}, 0)`,
    promedio_diario: `${FACT} / NULLIF(COUNT(DISTINCT l.fecha), 0)`,
  }
  const dir = config.orden.direccion === 'asc' ? 'ASC' : 'DESC'
  const indiceDim = dimensiones.indexOf(config.orden.campo as Dimension)
  const ordenSql =
    dimensiones.length === 0
      ? null
      : indiceDim >= 0
        ? `d${indiceDim} ${dir}`
        : `${ORDEN_METRICA[config.orden.campo as Metrica] ?? FACT} ${dir}`

  const [filas, [total]] = await Promise.all([
    consultar(filtros, dimensiones, perspectiva, dimensiones.length ? config.limite + 1 : null, ordenSql),
    consultar(filtros, [], perspectiva, null, null),
  ])
  const truncado = filas.length > config.limite
  if (truncado) {
    filas.pop()
    avisos.push(
      `Se muestran las primeras ${config.limite} filas. Exportá a Excel o ajustá los filtros para ver el resto.`,
    )
  }

  const totalAgregado = agregado(total ?? {})
  const conProducto = !soloPago
  const totales = derivar(totalAgregado, totalAgregado.facturacion, metricas, conProducto)

  const claveFila = (f: Record<string, unknown>) => dimensiones.map((_, i) => String(f[`d${i}`] ?? '∅')).join('|')
  const resultadoFilas: FilaReporte[] = filas.map(f => ({
    dimensiones: Object.fromEntries(dimensiones.map((d, i) => [d, etiquetaDimension(d, f[`d${i}`])])),
    valores: derivar(agregado(f), totalAgregado.facturacion, metricas, conProducto),
  }))

  let periodoComparado: ResultadoReporte['periodoComparado'] = null
  let totalesComparados: ResultadoReporte['totalesComparados'] = null
  let variacionTotales: ResultadoReporte['variacionTotales'] = null
  if (config.comparacion !== 'ninguna') {
    periodoComparado =
      config.comparacion === 'anio_anterior'
        ? mismoPeriodoAnioAnterior(filtros.desde, filtros.hasta)
        : periodoAnterior(filtros.desde, filtros.hasta)
    const filtrosComparados = { ...filtros, ...periodoComparado }
    const temporal = dimensiones.some(d => DIMENSIONES[d].temporal)
    const [filasAnt, [totalAnt]] = await Promise.all([
      temporal || dimensiones.length === 0
        ? Promise.resolve([])
        : consultar(filtrosComparados, dimensiones, perspectiva, null, null),
      consultar(filtrosComparados, [], perspectiva, null, null),
    ])
    const totalAntAgregado = agregado(totalAnt ?? {})
    totalesComparados = derivar(totalAntAgregado, totalAntAgregado.facturacion, metricas, conProducto)
    variacionTotales = Object.fromEntries(metricas.map(m => [m, variacion(totales[m], totalesComparados![m])]))
    if (temporal) {
      avisos.push('Con día, semana, mes o año como dimensión la comparación se muestra solo en los totales.')
    } else {
      const porClave = new Map(filasAnt.map(f => [claveFila(f), f]))
      filas.forEach((f, i) => {
        const anterior = porClave.get(claveFila(f))
        const comparado = derivar(
          anterior ? agregado(anterior) : { facturacion: 0, unidades: 0, tickets: 0, descuentos: 0, jornadas: 0 },
          totalAntAgregado.facturacion,
          metricas,
          conProducto,
        )
        resultadoFilas[i].comparado = comparado
        resultadoFilas[i].variacion = Object.fromEntries(
          metricas.map(m => [m, variacion(resultadoFilas[i].valores[m], comparado[m])]),
        )
      })
    }
  }

  const columnas: ColumnaReporte[] = [
    ...dimensiones.map(d => ({ clave: d, etiqueta: DIMENSIONES[d].etiqueta, tipo: 'dimension' as const })),
    ...metricas.map(m => ({ clave: m, etiqueta: METRICAS[m].etiqueta, tipo: METRICAS[m].formato })),
  ]

  return {
    columnas,
    filas: resultadoFilas,
    totales,
    totalesComparados,
    variacionTotales,
    periodo: { desde: filtros.desde, hasta: filtros.hasta },
    periodoComparado,
    truncado,
    avisos,
  }
}

const FORMATO_EXCEL: Record<ColumnaReporte['tipo'], string | undefined> = {
  dimension: undefined,
  moneda: '"$"#,##0.00',
  numero: '#,##0.##',
  porcentaje: '0.0"%"',
}

/** Agrega el reporte como hoja de un Excel (con título, filtros y totales). */
export function agregarHojaReporte(
  workbook: ExcelJS.Workbook,
  nombre: string,
  resultado: ResultadoReporte,
  descripcion: string[],
): void {
  const hoja = workbook.addWorksheet(nombre.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))
  hoja.addRow([nombre]).font = { bold: true, size: 14, color: { argb: 'FF002868' } }
  for (const linea of descripcion) hoja.addRow([linea]).font = { color: { argb: 'FF5A6B8C' } }
  hoja.addRow([])

  const conVariacion = resultado.filas.some(f => f.variacion)
  const encabezados = resultado.columnas.flatMap(c =>
    c.tipo !== 'dimension' && conVariacion ? [c.etiqueta, `${c.etiqueta} ant.`, `Var. %`] : [c.etiqueta],
  )
  const header = hoja.addRow(encabezados)
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002868' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  const filaHeader = header.number

  const valoresFila = (
    dims: Record<string, string> | null,
    valores: Record<string, number | null>,
    comparado?: Record<string, number | null> | null,
    variacionFila?: Record<string, number | null> | null,
  ) =>
    resultado.columnas.flatMap((c): Array<string | number | null> => {
      if (c.tipo === 'dimension') return [dims ? (dims[c.clave] ?? '') : 'Total']
      const v = valores[c.clave] ?? null
      return conVariacion ? [v, comparado?.[c.clave] ?? null, variacionFila?.[c.clave] ?? null] : [v]
    })

  for (const f of resultado.filas) hoja.addRow(valoresFila(f.dimensiones, f.valores, f.comparado, f.variacion))
  const filaTotal = hoja.addRow(
    resultado.columnas.some(c => c.tipo === 'dimension')
      ? valoresFila(null, resultado.totales, resultado.totalesComparados, resultado.variacionTotales)
      : valoresFila({}, resultado.totales, resultado.totalesComparados, resultado.variacionTotales),
  )
  filaTotal.font = { bold: true }
  filaTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FF' } }

  let col = 1
  for (const c of resultado.columnas) {
    const formatos =
      c.tipo !== 'dimension' && conVariacion
        ? [FORMATO_EXCEL[c.tipo], FORMATO_EXCEL[c.tipo], FORMATO_EXCEL.porcentaje]
        : [FORMATO_EXCEL[c.tipo]]
    for (const formato of formatos) {
      const columna = hoja.getColumn(col++)
      columna.width = c.tipo === 'dimension' ? 28 : 16
      if (formato) columna.numFmt = formato
    }
  }
  hoja.views = [{ state: 'frozen', ySplit: filaHeader }]
}
