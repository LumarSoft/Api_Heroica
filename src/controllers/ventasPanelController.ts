import { Request, Response } from 'express'
import { query } from '../config/database'
import {
  conRango,
  construirWhereVentas,
  FiltrosVentas,
  mismoPeriodoAnioAnterior,
  parsearFiltrosVentas,
  periodoAnterior,
  responderErrorVentas,
} from '../utils/ventasFiltros'

type Agrupacion = 'dia' | 'semana' | 'mes'
type Comparacion = 'periodo_anterior' | 'anio_anterior'

interface KpisVentas {
  facturacion: number
  cobrado: number
  tickets: number
  unidades: number
  ticketPromedio: number
  descuentos: number
  anuladas: { tickets: number; importe: number }
}

const TOP_PRODUCTOS = 10
const num = (v: unknown): number => Number(v ?? 0) || 0
const redondear = (v: number) => Math.round(v * 100) / 100

const FORMATO_PERIODO: Record<Agrupacion, string> = {
  dia: "DATE_FORMAT(l.fecha, '%Y-%m-%d')",
  // Semana ISO que arranca el lunes; se muestra por la fecha del lunes.
  semana: "DATE_FORMAT(DATE_SUB(l.fecha, INTERVAL WEEKDAY(l.fecha) DAY), '%Y-%m-%d')",
  mes: "DATE_FORMAT(l.fecha, '%Y-%m')",
}

async function calcularKpis(filtros: FiltrosVentas): Promise<KpisVentas> {
  // Facturación neta = ítems + descuentos. Las ventas se cuentan por encabezado de ticket.
  const venta = construirWhereVentas(filtros, 'venta')
  const pago = construirWhereVentas(filtros, 'pago')
  const anul = construirWhereVentas(filtros, 'pago', { incluirAnuladas: true })

  const [productos, pagos, tickets, anuladas] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(l.importe), 0) AS facturacion, COALESCE(SUM(l.cantidad), 0) AS unidades,
              COALESCE(SUM(l.descuento), 0) AS descuentos
       FROM ventas_lineas l WHERE ${venta.where}`,
      venta.params,
    ) as Promise<Array<Record<string, unknown>>>,
    query(
      `SELECT COALESCE(SUM(l.importe), 0) AS cobrado FROM ventas_lineas l WHERE ${pago.where}`,
      pago.params,
    ) as Promise<Array<Record<string, unknown>>>,
    query(
      `SELECT COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets FROM ventas_lineas l WHERE ${pago.where}`,
      pago.params,
    ) as Promise<Array<Record<string, unknown>>>,
    query(
      `SELECT COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets, COALESCE(SUM(l.importe), 0) AS importe
       FROM ventas_lineas l WHERE ${anul.where} AND l.anulada = 1 AND l.importe > 0`,
      anul.params,
    ) as Promise<Array<Record<string, unknown>>>,
  ])

  const facturacion = num(productos[0]?.facturacion)
  const cantTickets = num(tickets[0]?.tickets)
  return {
    facturacion: redondear(facturacion),
    cobrado: redondear(num(pagos[0]?.cobrado)),
    tickets: cantTickets,
    unidades: num(productos[0]?.unidades),
    ticketPromedio: cantTickets > 0 ? redondear(facturacion / cantTickets) : 0,
    descuentos: redondear(num(productos[0]?.descuentos)),
    anuladas: { tickets: num(anuladas[0]?.tickets), importe: redondear(num(anuladas[0]?.importe)) },
  }
}

async function calcularDesgloses(filtros: FiltrosVentas, agrupacion: Agrupacion) {
  const prod = construirWhereVentas(filtros, 'producto')
  const venta = construirWhereVentas(filtros, 'venta')
  const pago = construirWhereVentas(filtros, 'pago')

  const [evolucion, porSucursal, topImporte, topUnidades, categorias, franjas, dias, medios, canales, diasConDatos] =
    await Promise.all([
      query(
        `SELECT ${FORMATO_PERIODO[agrupacion]} AS periodo, SUM(l.importe) AS facturacion,
                COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets
         FROM ventas_lineas l WHERE ${venta.where} GROUP BY periodo ORDER BY periodo`,
        venta.params,
      ),
      query(
        `SELECT l.sucursal_id AS sucursalId, COALESCE(s.nombre, 'Sin sucursal asignada') AS sucursal,
                SUM(l.importe) AS facturacion, SUM(l.cantidad) AS unidades,
                COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets
         FROM ventas_lineas l LEFT JOIN sucursales s ON s.id = l.sucursal_id
         WHERE ${venta.where} GROUP BY l.sucursal_id, s.nombre ORDER BY facturacion DESC`,
        venta.params,
      ),
      query(
        `SELECT COALESCE(l.producto_nombre, 'Sin nombre') AS producto, MAX(l.categoria) AS categoria,
                SUM(l.cantidad) AS unidades, SUM(l.importe) AS facturacion
         FROM ventas_lineas l WHERE ${prod.where}
         GROUP BY producto ORDER BY facturacion DESC LIMIT ${TOP_PRODUCTOS}`,
        prod.params,
      ),
      query(
        `SELECT COALESCE(l.producto_nombre, 'Sin nombre') AS producto, MAX(l.categoria) AS categoria,
                SUM(l.cantidad) AS unidades, SUM(l.importe) AS facturacion
         FROM ventas_lineas l WHERE ${prod.where}
         GROUP BY producto ORDER BY unidades DESC LIMIT ${TOP_PRODUCTOS}`,
        prod.params,
      ),
      query(
        `SELECT COALESCE(l.categoria, 'Sin categoría') AS categoria, SUM(l.cantidad) AS unidades,
                SUM(l.importe) AS facturacion
         FROM ventas_lineas l WHERE ${prod.where} GROUP BY categoria ORDER BY facturacion DESC`,
        prod.params,
      ),
      query(
        `SELECT HOUR(l.fecha_hora) AS hora, SUM(l.importe) AS facturacion,
                COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets
         FROM ventas_lineas l WHERE ${venta.where} AND l.fecha_hora IS NOT NULL GROUP BY hora ORDER BY hora`,
        venta.params,
      ),
      query(
        `SELECT WEEKDAY(l.fecha) AS dia, SUM(l.importe) AS facturacion,
                COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets,
                COUNT(DISTINCT l.fecha) AS jornadas
         FROM ventas_lineas l WHERE ${venta.where} GROUP BY dia ORDER BY dia`,
        venta.params,
      ),
      query(
        `SELECT COALESCE(l.medio_pago, 'Sin informar') AS medioPago, SUM(l.importe) AS importe,
                COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS operaciones
         FROM ventas_lineas l WHERE ${pago.where} GROUP BY medioPago ORDER BY importe DESC`,
        pago.params,
      ),
      query(
        `SELECT COALESCE(l.canal, 'Sin informar') AS canal, SUM(l.importe) AS facturacion,
                COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets
         FROM ventas_lineas l WHERE ${venta.where} GROUP BY canal ORDER BY facturacion DESC`,
        venta.params,
      ),
      query(
        `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha FROM ventas_dias_sincronizados WHERE fecha BETWEEN ? AND ?`,
        [filtros.desde, filtros.hasta],
      ),
    ])

  type Fila = Record<string, unknown>
  const filas = (r: unknown) => r as Fila[]

  return {
    evolucion: completarPeriodos(
      filas(evolucion).map(f => ({
        periodo: String(f.periodo),
        facturacion: redondear(num(f.facturacion)),
        tickets: num(f.tickets),
      })),
      filtros,
      agrupacion,
      new Set((diasConDatos as Array<{ fecha: string }>).map(f => f.fecha)),
    ),
    porSucursal: filas(porSucursal).map(f => {
      const facturacion = num(f.facturacion)
      const tickets = num(f.tickets)
      return {
        sucursalId: f.sucursalId === null ? null : num(f.sucursalId),
        sucursal: String(f.sucursal),
        facturacion: redondear(facturacion),
        unidades: num(f.unidades),
        tickets,
        ticketPromedio: tickets > 0 ? redondear(facturacion / tickets) : 0,
      }
    }),
    topProductosImporte: filas(topImporte).map(mapearProducto),
    topProductosUnidades: filas(topUnidades).map(mapearProducto),
    categorias: filas(categorias).map(f => ({
      categoria: String(f.categoria),
      unidades: num(f.unidades),
      facturacion: redondear(num(f.facturacion)),
    })),
    franjaHoraria: filas(franjas).map(f => ({
      hora: num(f.hora),
      facturacion: redondear(num(f.facturacion)),
      tickets: num(f.tickets),
    })),
    diaSemana: filas(dias).map(f => {
      const jornadas = num(f.jornadas)
      return {
        // WEEKDAY(): 0 = lunes … 6 = domingo
        dia: num(f.dia),
        facturacion: redondear(num(f.facturacion)),
        tickets: num(f.tickets),
        promedioPorJornada: jornadas > 0 ? redondear(num(f.facturacion) / jornadas) : 0,
      }
    }),
    mediosPago: filas(medios).map(f => ({
      medioPago: String(f.medioPago),
      importe: redondear(num(f.importe)),
      operaciones: num(f.operaciones),
    })),
    canales: filas(canales).map(f => ({
      canal: String(f.canal),
      facturacion: redondear(num(f.facturacion)),
      tickets: num(f.tickets),
    })),
  }
}

async function diasImportados(desde: string, hasta: string): Promise<{ diasConDatos: number; diasTotales: number }> {
  const [fila] = (await query('SELECT COUNT(*) AS dias FROM ventas_dias_sincronizados WHERE fecha BETWEEN ? AND ?', [
    desde,
    hasta,
  ])) as Array<{ dias: number }>
  const diasTotales = Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000) + 1
  return { diasConDatos: Number(fila?.dias ?? 0), diasTotales }
}

/**
 * Todos los períodos del rango, con cero donde no hubo ventas: un día sin ventas
 * no puede desaparecer del eje temporal.
 */
function completarPeriodos(
  puntos: Array<{ periodo: string; facturacion: number; tickets: number }>,
  filtros: FiltrosVentas,
  agrupacion: Agrupacion,
  importados: Set<string>,
): Array<{ periodo: string; facturacion: number | null; tickets: number | null }> {
  const porPeriodo = new Map(puntos.map(p => [p.periodo, p]))
  const claves: string[] = []
  const actual = new Date(`${filtros.desde}T12:00:00Z`)
  const fin = new Date(`${filtros.hasta}T12:00:00Z`)
  if (agrupacion === 'semana') actual.setUTCDate(actual.getUTCDate() - ((actual.getUTCDay() + 6) % 7))
  if (agrupacion === 'mes') actual.setUTCDate(1)

  while (actual <= fin && claves.length < 1000) {
    const iso = actual.toISOString()
    claves.push(agrupacion === 'mes' ? iso.slice(0, 7) : iso.slice(0, 10))
    if (agrupacion === 'dia') actual.setUTCDate(actual.getUTCDate() + 1)
    else if (agrupacion === 'semana') actual.setUTCDate(actual.getUTCDate() + 7)
    else actual.setUTCMonth(actual.getUTCMonth() + 1)
  }
  // Un período sin ningún día importado va como null (hueco en el gráfico), no como $0:
  // "no importado" no es lo mismo que "no se vendió".
  const tieneDatos = (periodo: string) =>
    [...importados].some(dia =>
      agrupacion === 'mes'
        ? dia.startsWith(periodo)
        : agrupacion === 'semana'
          ? dia >= periodo && dia <= sumarDiasIso(periodo, 6)
          : dia === periodo,
    )
  return claves.map(
    periodo =>
      porPeriodo.get(periodo) ??
      (tieneDatos(periodo) ? { periodo, facturacion: 0, tickets: 0 } : { periodo, facturacion: null, tickets: null }),
  )
}

function sumarDiasIso(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function mapearProducto(f: Record<string, unknown>) {
  return {
    producto: String(f.producto),
    categoria: f.categoria === null || f.categoria === undefined ? null : String(f.categoria),
    unidades: num(f.unidades),
    facturacion: redondear(num(f.facturacion)),
  }
}

/**
 * GET /api/ventas/panel
 * ?desde&hasta (obligatorios) &sucursal_ids=1,2 &categoria &medio_pago &canal &producto
 * &agrupacion=dia|semana|mes &comparacion=periodo_anterior|anio_anterior
 */
export const getPanelVentas = async (req: Request, res: Response) => {
  try {
    const filtros = await parsearFiltrosVentas(req)
    const agrupacion: Agrupacion = ['dia', 'semana', 'mes'].includes(String(req.query.agrupacion))
      ? (req.query.agrupacion as Agrupacion)
      : 'dia'
    const comparacion: Comparacion = req.query.comparacion === 'anio_anterior' ? 'anio_anterior' : 'periodo_anterior'
    const rangoComparado =
      comparacion === 'anio_anterior'
        ? mismoPeriodoAnioAnterior(filtros.desde, filtros.hasta)
        : periodoAnterior(filtros.desde, filtros.hasta)

    const [kpis, kpisComparados, desgloses, diasPeriodo, diasComparado] = await Promise.all([
      calcularKpis(filtros),
      calcularKpis(conRango(filtros, rangoComparado.desde, rangoComparado.hasta)),
      calcularDesgloses(filtros, agrupacion),
      diasImportados(filtros.desde, filtros.hasta),
      diasImportados(rangoComparado.desde, rangoComparado.hasta),
    ])

    res.json({
      success: true,
      data: {
        kpis,
        // Cuántos días de cada período están importados: sin esto, un período vacío se
        // leería como "vendimos 0" y la variación daría un -100% engañoso.
        periodo: { desde: filtros.desde, hasta: filtros.hasta, ...diasPeriodo },
        comparacion: { tipo: comparacion, ...rangoComparado, ...diasComparado, kpis: kpisComparados },
        agrupacion,
        ...desgloses,
      },
    })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'getPanelVentas')
  }
}

/** GET /api/ventas/filtros — opciones para los selectores del panel. */
export const getOpcionesFiltros = async (req: Request, res: Response) => {
  try {
    const filtros = await parsearFiltrosVentas(req, {
      desde: new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10),
      hasta: new Date().toISOString().slice(0, 10),
    })
    const sinSucursal = { ...filtros, sucursalIds: [] }
    const base = construirWhereVentas(sinSucursal, 'todas', { incluirAnuladas: true })
    const baseProductos = construirWhereVentas(sinSucursal, 'producto', { incluirAnuladas: true })
    const basePagos = construirWhereVentas(sinSucursal, 'pago', { incluirAnuladas: true })

    const [sucursales, categorias, medios, canales] = await Promise.all([
      query(
        `SELECT DISTINCT s.id, s.nombre FROM ventas_locales_externos le
         JOIN sucursales s ON s.id = le.sucursal_id AND s.deleted_at IS NULL
         ${filtros.alcance === null ? '' : filtros.alcance.length ? `WHERE s.id IN (${filtros.alcance.map(() => '?').join(', ')})` : 'WHERE 1 = 0'}
         ORDER BY s.nombre`,
        filtros.alcance ?? [],
      ),
      query(
        `SELECT DISTINCT l.categoria AS valor FROM ventas_lineas l
         WHERE ${baseProductos.where} AND l.categoria IS NOT NULL ORDER BY valor`,
        baseProductos.params,
      ),
      query(
        `SELECT DISTINCT l.medio_pago AS valor FROM ventas_lineas l
         WHERE ${basePagos.where} AND l.medio_pago IS NOT NULL ORDER BY valor`,
        basePagos.params,
      ),
      query(
        `SELECT DISTINCT l.canal AS valor FROM ventas_lineas l WHERE ${base.where} AND l.canal IS NOT NULL ORDER BY valor`,
        base.params,
      ),
    ])

    const valores = (r: unknown) => (r as Array<{ valor: string }>).map(f => f.valor)
    res.json({
      success: true,
      data: {
        sucursales: (sucursales as Array<{ id: number; nombre: string }>).map(s => ({ id: s.id, nombre: s.nombre })),
        categorias: valores(categorias),
        mediosPago: valores(medios),
        canales: valores(canales),
      },
    })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'getOpcionesFiltros')
  }
}
