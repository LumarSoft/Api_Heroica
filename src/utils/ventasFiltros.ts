import type { Request, Response } from 'express'
import { esSuperadmin, getSucursalesDeUsuario } from '../services/authCacheService'

/**
 * Filtros combinables del módulo de ventas.
 *
 * Las líneas de una venta son de dos tipos (producto y medio de pago), así que un
 * filtro de "producto" aplicado a métricas de medios de pago (o al revés) se traduce
 * a nivel transacción: "ventas que incluyeron ese producto / se cobraron con ese medio".
 */

export interface FiltrosVentas {
  desde: string
  hasta: string
  sucursalIds: number[]
  categoria: string | null
  medioPago: string | null
  canal: string | null
  producto: string | null
  vendedor: string | null
  caja: string | null
  /** null = todas las sucursales (superadmin). Array = alcance del usuario. */
  alcance: number[] | null
}

/**
 * producto: ítems vendidos · venta: ítems + descuentos (facturación neta) ·
 * pago: encabezados de ticket (total y medio de pago) · todas: todo menos movimientos de caja.
 */
export type PerspectivaLineas = 'producto' | 'venta' | 'pago' | 'todas'

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DIAS_CONSULTA = 800

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim().slice(0, 150) : null
}

export class FiltroInvalidoError extends Error {}

/**
 * Lee los filtros de la query (GET) o de `origen` (body de un POST, ej. el constructor
 * de reportes). Siempre aplica el alcance de sucursales del usuario.
 */
export async function parsearFiltrosVentas(
  req: Request,
  rangoFijo?: { desde: string; hasta: string },
  origen: Record<string, unknown> = req.query as Record<string, unknown>,
): Promise<FiltrosVentas> {
  const desde = rangoFijo?.desde ?? texto(origen.desde)
  const hasta = rangoFijo?.hasta ?? texto(origen.hasta)
  if (!desde || !hasta || !FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) {
    throw new FiltroInvalidoError('Las fechas desde y hasta son obligatorias (YYYY-MM-DD)')
  }
  if (desde > hasta) throw new FiltroInvalidoError('La fecha desde no puede ser posterior a hasta')
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000
  if (dias > MAX_DIAS_CONSULTA) throw new FiltroInvalidoError('El rango de fechas es demasiado amplio')

  const sucursalIdsCrudo = Array.isArray(origen.sucursal_ids) ? origen.sucursal_ids.join(',') : origen.sucursal_ids
  const sucursalIds = (
    typeof sucursalIdsCrudo === 'number' ? String(sucursalIdsCrudo) : (texto(sucursalIdsCrudo) ?? '')
  )
    .split(',')
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)

  const user = req.user!
  const alcance = (await esSuperadmin(user.rol_id)) ? null : [...(await getSucursalesDeUsuario(user.id))]

  return {
    desde,
    hasta,
    sucursalIds,
    categoria: texto(origen.categoria),
    medioPago: texto(origen.medio_pago),
    canal: texto(origen.canal),
    producto: texto(origen.producto),
    vendedor: texto(origen.vendedor),
    caja: texto(origen.caja),
    alcance,
  }
}

/** Mismo filtro, con otro rango de fechas (para comparar períodos). */
export function conRango(filtros: FiltrosVentas, desde: string, hasta: string): FiltrosVentas {
  return { ...filtros, desde, hasta }
}

const EXISTE_EN_TRANSACCION = (condicion: string) =>
  `EXISTS (SELECT 1 FROM ventas_lineas x
           WHERE x.fuente = l.fuente AND x.fecha = l.fecha AND x.transaccion_id = l.transaccion_id
             AND ${condicion})`

/**
 * Arma el WHERE sobre `ventas_lineas l`. `perspectiva` indica qué tipo de línea se
 * está agregando; los filtros del otro tipo se aplican a nivel transacción.
 */
export function construirWhereVentas(
  filtros: FiltrosVentas,
  perspectiva: PerspectivaLineas,
  opciones: { incluirAnuladas?: boolean } = {},
): { where: string; params: unknown[] } {
  const condiciones: string[] = ['l.fecha BETWEEN ? AND ?']
  const params: unknown[] = [filtros.desde, filtros.hasta]

  if (perspectiva === 'producto' || perspectiva === 'pago') {
    condiciones.push('l.tipo_linea = ?')
    params.push(perspectiva)
  } else if (perspectiva === 'venta') {
    condiciones.push("l.tipo_linea IN ('producto', 'descuento')")
  } else {
    condiciones.push("l.tipo_linea <> 'caja'")
  }
  if (!opciones.incluirAnuladas) condiciones.push('l.anulada = 0')

  if (filtros.alcance !== null) {
    if (filtros.alcance.length === 0) {
      condiciones.push('1 = 0')
    } else {
      condiciones.push(`l.sucursal_id IN (${filtros.alcance.map(() => '?').join(', ')})`)
      params.push(...filtros.alcance)
    }
  }
  if (filtros.sucursalIds.length > 0) {
    condiciones.push(`l.sucursal_id IN (${filtros.sucursalIds.map(() => '?').join(', ')})`)
    params.push(...filtros.sucursalIds)
  }
  if (filtros.canal) {
    condiciones.push('l.canal = ?')
    params.push(filtros.canal)
  }
  // Vendedor y caja se repiten en todas las líneas del documento (incluido el encabezado).
  if (filtros.vendedor) {
    condiciones.push('l.vendedor = ?')
    params.push(filtros.vendedor)
  }
  if (filtros.caja) {
    condiciones.push('l.caja = ?')
    params.push(filtros.caja)
  }

  const filtroProducto: string[] = []
  const paramsProducto: unknown[] = []
  if (filtros.categoria) {
    filtroProducto.push('categoria = ?')
    paramsProducto.push(filtros.categoria)
  }
  if (filtros.producto) {
    filtroProducto.push('(producto_nombre LIKE ? OR producto_codigo = ?)')
    paramsProducto.push(`%${filtros.producto}%`, filtros.producto)
  }
  if (filtroProducto.length > 0) {
    if (perspectiva === 'producto' || perspectiva === 'venta') {
      condiciones.push(...filtroProducto.map(c => c.replace(/(categoria|producto_nombre|producto_codigo)/g, 'l.$1')))
    } else {
      condiciones.push(
        EXISTE_EN_TRANSACCION(
          `x.tipo_linea = 'producto' AND ${filtroProducto
            .map(c => c.replace(/(categoria|producto_nombre|producto_codigo)/g, 'x.$1'))
            .join(' AND ')}`,
        ),
      )
    }
    params.push(...paramsProducto)
  }

  if (filtros.medioPago) {
    if (perspectiva === 'pago') {
      condiciones.push('l.medio_pago = ?')
    } else {
      condiciones.push(EXISTE_EN_TRANSACCION(`x.tipo_linea = 'pago' AND x.medio_pago = ?`))
    }
    params.push(filtros.medioPago)
  }

  return { where: condiciones.join(' AND '), params }
}

/** Período inmediatamente anterior de igual duración. */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const d = new Date(`${desde}T12:00:00Z`)
  const h = new Date(`${hasta}T12:00:00Z`)
  const dias = Math.round((h.getTime() - d.getTime()) / 86_400_000) + 1
  const nuevoHasta = new Date(d.getTime() - 86_400_000)
  const nuevoDesde = new Date(nuevoHasta.getTime() - (dias - 1) * 86_400_000)
  return { desde: nuevoDesde.toISOString().slice(0, 10), hasta: nuevoHasta.toISOString().slice(0, 10) }
}

/** Mismo rango un año antes, corrido a igual día de la semana (364 días = 52 semanas). */
export function mismoPeriodoAnioAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const correr = (fecha: string) =>
    new Date(new Date(`${fecha}T12:00:00Z`).getTime() - 364 * 86_400_000).toISOString().slice(0, 10)
  return { desde: correr(desde), hasta: correr(hasta) }
}

export function responderErrorVentas(res: Response, err: unknown, contexto: string): void {
  if (err instanceof FiltroInvalidoError) {
    res.status(400).json({ success: false, message: err.message })
    return
  }
  console.error(`[Ventas] Error en ${contexto}:`, err instanceof Error ? err.message : err)
  if (!res.headersSent) res.status(500).json({ success: false, message: 'Error al consultar las ventas' })
}
