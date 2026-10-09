import { query } from '../../config/database'
import { construirWhereVentas, periodoAnterior, type FiltrosVentas } from '../../utils/ventasFiltros'

/**
 * Análisis listos para usar: productos (curva ABC y tendencias), mapa de calor
 * día × hora y desempeño por vendedor y caja.
 */

const num = (v: unknown): number => Number(v ?? 0) || 0
const redondear = (v: number, dec = 2) => Math.round(v * 10 ** dec) / 10 ** dec
const MAX_PRODUCTOS = 3000
const MIN_BASE_TENDENCIA = 5 // unidades en el período anterior para hablar de alza o baja

function variacion(actual: number, anterior: number): number | null {
  if (anterior === 0) return null
  return redondear(((actual - anterior) / Math.abs(anterior)) * 100, 1)
}

// ─── Productos ────────────────────────────────────────────────────────────────

export type ClaseAbc = 'A' | 'B' | 'C'

export interface ProductoAnalizado {
  producto: string
  codigo: string | null
  categoria: string | null
  facturacion: number
  unidades: number
  tickets: number
  sucursales: number
  precioPromedio: number | null
  participacion: number
  acumulado: number
  clase: ClaseAbc
  /** % de los tickets del período que incluyeron el producto. */
  penetracion: number | null
  facturacionAnterior: number
  unidadesAnterior: number
  variacionFacturacion: number | null
  variacionUnidades: number | null
}

async function productosDelPeriodo(filtros: FiltrosVentas) {
  const { where, params } = construirWhereVentas(filtros, 'producto')
  return (await query(
    `SELECT COALESCE(l.producto_nombre, 'Sin nombre') AS producto, MAX(l.producto_codigo) AS codigo,
            MAX(l.categoria) AS categoria, SUM(l.importe) AS facturacion, SUM(l.cantidad) AS unidades,
            COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets, COUNT(DISTINCT l.sucursal_id) AS sucursales
     FROM ventas_lineas l WHERE ${where}
     GROUP BY producto ORDER BY facturacion DESC LIMIT ${MAX_PRODUCTOS}`,
    params,
  )) as Array<Record<string, unknown>>
}

async function ticketsDelPeriodo(filtros: FiltrosVentas): Promise<number> {
  const { where, params } = construirWhereVentas(filtros, 'pago')
  const [fila] = (await query(
    `SELECT COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets FROM ventas_lineas l WHERE ${where}`,
    params,
  )) as Array<{ tickets: number }>
  return num(fila?.tickets)
}

export async function analizarProductos(filtros: FiltrosVentas) {
  const anterior = periodoAnterior(filtros.desde, filtros.hasta)
  const [actuales, previos, ticketsTotales] = await Promise.all([
    productosDelPeriodo(filtros),
    productosDelPeriodo({ ...filtros, ...anterior }),
    ticketsDelPeriodo(filtros),
  ])

  const porNombre = new Map(previos.map(p => [String(p.producto), p]))
  const facturacionTotal = actuales.reduce((acc, p) => acc + Math.max(num(p.facturacion), 0), 0)

  let acumulado = 0
  const productos: ProductoAnalizado[] = actuales.map(p => {
    const facturacion = num(p.facturacion)
    const unidades = num(p.unidades)
    const previo = porNombre.get(String(p.producto))
    const facturacionAnterior = num(previo?.facturacion)
    const unidadesAnterior = num(previo?.unidades)
    const participacion = facturacionTotal > 0 ? (Math.max(facturacion, 0) / facturacionTotal) * 100 : 0
    const acumuladoPrevio = acumulado
    acumulado += participacion
    // Curva ABC: A = productos que hacen el primer 80% de la facturación, B = hasta el 95%, C = el resto.
    const clase: ClaseAbc = facturacion <= 0 ? 'C' : acumuladoPrevio < 80 ? 'A' : acumuladoPrevio < 95 ? 'B' : 'C'
    return {
      producto: String(p.producto),
      codigo: p.codigo === null || p.codigo === undefined ? null : String(p.codigo),
      categoria: p.categoria === null || p.categoria === undefined ? null : String(p.categoria),
      facturacion: redondear(facturacion),
      unidades: redondear(unidades, 3),
      tickets: num(p.tickets),
      sucursales: num(p.sucursales),
      precioPromedio: unidades !== 0 ? redondear(facturacion / unidades) : null,
      participacion: redondear(participacion),
      acumulado: redondear(Math.min(acumulado, 100)),
      clase,
      penetracion: ticketsTotales > 0 ? redondear((num(p.tickets) / ticketsTotales) * 100) : null,
      facturacionAnterior: redondear(facturacionAnterior),
      unidadesAnterior: redondear(unidadesAnterior, 3),
      variacionFacturacion: variacion(facturacion, facturacionAnterior),
      variacionUnidades: variacion(unidades, unidadesAnterior),
    }
  })

  const clases = (['A', 'B', 'C'] as ClaseAbc[]).map(clase => {
    const grupo = productos.filter(p => p.clase === clase)
    const facturacion = grupo.reduce((acc, p) => acc + p.facturacion, 0)
    return {
      clase,
      productos: grupo.length,
      facturacion: redondear(facturacion),
      participacion: facturacionTotal > 0 ? redondear((facturacion / facturacionTotal) * 100) : 0,
    }
  })

  const conBase = productos.filter(p => p.unidadesAnterior >= MIN_BASE_TENDENCIA && p.variacionUnidades !== null)
  const enAlza = [...conBase]
    .filter(p => (p.variacionUnidades ?? 0) > 0)
    .sort((a, b) => (b.variacionUnidades ?? 0) - (a.variacionUnidades ?? 0))
    .slice(0, 10)
  const enBaja = [...conBase]
    .filter(p => (p.variacionUnidades ?? 0) < 0)
    .sort((a, b) => (a.variacionUnidades ?? 0) - (b.variacionUnidades ?? 0))
    .slice(0, 10)
  const nuevos = productos.filter(p => p.unidadesAnterior === 0 && p.unidades > 0).slice(0, 15)
  const vendidos = new Set(productos.map(p => p.producto))
  const sinVentas = previos
    .filter(p => !vendidos.has(String(p.producto)) && num(p.unidades) > 0)
    .slice(0, 15)
    .map(p => ({
      producto: String(p.producto),
      categoria: p.categoria === null || p.categoria === undefined ? null : String(p.categoria),
      unidadesAnterior: redondear(num(p.unidades), 3),
      facturacionAnterior: redondear(num(p.facturacion)),
    }))

  return {
    periodo: { desde: filtros.desde, hasta: filtros.hasta },
    periodoAnterior: anterior,
    resumen: {
      productos: productos.length,
      facturacion: redondear(facturacionTotal),
      ticketsTotales,
      clases,
    },
    productos,
    enAlza,
    enBaja,
    nuevos,
    sinVentas,
    truncado: actuales.length >= MAX_PRODUCTOS,
  }
}

// ─── Mapa de calor día × hora ─────────────────────────────────────────────────

export async function mapaDeCalor(filtros: FiltrosVentas) {
  const { where, params } = construirWhereVentas(filtros, 'venta')
  const [celdas, dias] = (await Promise.all([
    query(
      `SELECT WEEKDAY(l.fecha) AS dia, HOUR(l.fecha_hora) AS hora, SUM(l.importe) AS facturacion,
              COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets, SUM(l.cantidad) AS unidades
       FROM ventas_lineas l WHERE ${where} AND l.fecha_hora IS NOT NULL
       GROUP BY dia, hora`,
      params,
    ),
    query(
      `SELECT WEEKDAY(fecha) AS dia, COUNT(DISTINCT fecha) AS jornadas FROM ventas_dias_sincronizados
       WHERE fecha BETWEEN ? AND ? GROUP BY dia`,
      [filtros.desde, filtros.hasta],
    ),
  ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>]

  // Promedio por jornada: un martes con 4 martes importados se divide por 4.
  const jornadas = Array.from({ length: 7 }, (_, d) => num(dias.find(x => num(x.dia) === d)?.jornadas))
  const resultado = celdas.map(c => {
    const dia = num(c.dia)
    const j = jornadas[dia] || 1
    return {
      dia,
      hora: num(c.hora),
      facturacion: redondear(num(c.facturacion)),
      tickets: num(c.tickets),
      unidades: redondear(num(c.unidades), 3),
      promedioFacturacion: redondear(num(c.facturacion) / j),
      promedioTickets: redondear(num(c.tickets) / j, 1),
    }
  })

  const porHora = Array.from({ length: 24 }, (_, hora) => {
    const grupo = resultado.filter(c => c.hora === hora)
    return {
      hora,
      facturacion: redondear(grupo.reduce((a, c) => a + c.facturacion, 0)),
      tickets: grupo.reduce((a, c) => a + c.tickets, 0),
    }
  })
  const pico = [...resultado].sort((a, b) => b.promedioFacturacion - a.promedioFacturacion)[0] ?? null
  const horaPico = [...porHora].sort((a, b) => b.facturacion - a.facturacion)[0]
  return {
    periodo: { desde: filtros.desde, hasta: filtros.hasta },
    jornadas,
    celdas: resultado,
    porHora,
    pico,
    horaPico: horaPico && horaPico.facturacion > 0 ? horaPico.hora : null,
    sinHora: resultado.length === 0,
  }
}

// ─── Vendedores y cajas ───────────────────────────────────────────────────────

async function desempenio(filtros: FiltrosVentas, columna: 'vendedor' | 'caja') {
  const venta = construirWhereVentas(filtros, 'venta')
  const pagos = construirWhereVentas(filtros, 'pago', { incluirAnuladas: true })
  const [filas, anuladas] = (await Promise.all([
    query(
      `SELECT COALESCE(l.${columna}, 'Sin informar') AS grupo, SUM(l.importe) AS facturacion, SUM(l.cantidad) AS unidades,
              SUM(l.descuento) AS descuentos, COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets,
              COUNT(DISTINCT l.fecha) AS jornadas,
              GROUP_CONCAT(DISTINCT s.nombre ORDER BY s.nombre SEPARATOR ', ') AS sucursales
       FROM ventas_lineas l LEFT JOIN sucursales s ON s.id = l.sucursal_id
       WHERE ${venta.where} GROUP BY grupo ORDER BY facturacion DESC`,
      venta.params,
    ),
    query(
      `SELECT COALESCE(l.${columna}, 'Sin informar') AS grupo, COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets,
              SUM(l.importe) AS importe
       FROM ventas_lineas l WHERE ${pagos.where} AND l.anulada = 1 GROUP BY grupo`,
      pagos.params,
    ),
  ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>]

  const anulPorNombre = new Map(anuladas.map(a => [String(a.grupo), a]))
  const total = filas.reduce((acc, f) => acc + num(f.facturacion), 0)
  return filas.map(f => {
    const facturacion = num(f.facturacion)
    const tickets = num(f.tickets)
    const unidades = num(f.unidades)
    const descuentos = num(f.descuentos)
    const jornadas = num(f.jornadas)
    const anul = anulPorNombre.get(String(f.grupo))
    return {
      nombre: String(f.grupo),
      sucursales: f.sucursales ? String(f.sucursales) : null,
      facturacion: redondear(facturacion),
      participacion: total > 0 ? redondear((facturacion / total) * 100) : 0,
      tickets,
      ticketPromedio: tickets > 0 ? redondear(facturacion / tickets) : 0,
      unidades: redondear(unidades, 3),
      unidadesPorTicket: tickets > 0 ? redondear(unidades / tickets) : 0,
      descuentos: redondear(descuentos),
      porcentajeDescuento:
        facturacion + descuentos > 0 ? redondear((descuentos / (facturacion + descuentos)) * 100) : 0,
      jornadas,
      promedioDiario: jornadas > 0 ? redondear(facturacion / jornadas) : 0,
      anuladas: { tickets: num(anul?.tickets), importe: redondear(num(anul?.importe)) },
    }
  })
}

export async function analizarVendedores(filtros: FiltrosVentas) {
  const [vendedores, cajas] = await Promise.all([desempenio(filtros, 'vendedor'), desempenio(filtros, 'caja')])
  return {
    periodo: { desde: filtros.desde, hasta: filtros.hasta },
    vendedoresDisponibles: vendedores.some(v => v.nombre !== 'Sin informar'),
    cajasDisponibles: cajas.some(c => c.nombre !== 'Sin informar'),
    vendedores,
    cajas,
  }
}
