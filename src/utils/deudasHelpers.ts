import { query } from '../config/database'
import { formatearFechaRespuesta } from './movimientosHelpers'

export interface DeudaPendiente {
  id: number
  sucursal_id: number
  fecha: string | null
  descripcion: string | null
  monto: number
  comentarios: string | null
  tipo: 'ingreso' | 'egreso'
  tipo_movimiento: string
  saldo: string
  estado: string
  es_deuda: number
  fecha_original_vencimiento: string | null
  moneda: 'ARS' | 'USD' | null
  sucursal_nombre: string
  sucursal_relacionada_nombre: string | null
}

export const ETIQUETA_TERCEROS = 'Terceros'

interface FiltroDeudas {
  /** Sucursales a incluir; sin definir = todas las activas. */
  sucursalIds?: (number | string)[]
  fechaInicio?: string
  fechaFin?: string
}

// Deudas y préstamos pendientes (no completados) de sucursales activas, opcionalmente acotados por fecha.
export async function obtenerDeudasPendientes({
  sucursalIds,
  fechaInicio,
  fechaFin,
}: FiltroDeudas): Promise<DeudaPendiente[]> {
  if (sucursalIds && sucursalIds.length === 0) return []

  let sql = `
    SELECT
      m.id, m.sucursal_id, m.fecha, d.nombre AS descripcion, m.monto, m.comentarios,
      m.tipo, m.tipo_movimiento, m.saldo, m.estado, m.es_deuda,
      m.fecha_original_vencimiento, m.moneda,
      suc.nombre AS sucursal_nombre,
      contraparte_suc.nombre AS sucursal_relacionada_nombre
    FROM movimientos m
    INNER JOIN sucursales suc ON m.sucursal_id = suc.id
    LEFT JOIN descripciones d ON m.descripcion_id = d.id
    LEFT JOIN movimientos contraparte ON contraparte.id = m.movimiento_contraparte_id
    LEFT JOIN sucursales contraparte_suc ON contraparte_suc.id = contraparte.sucursal_id
    WHERE m.es_deuda = 1
      AND m.estado != 'completado'
      AND m.deleted_at IS NULL
      AND suc.activo = 1
  `
  const params: (string | number)[] = []

  if (sucursalIds) {
    sql += ` AND m.sucursal_id IN (${sucursalIds.map(() => '?').join(', ')})`
    params.push(...sucursalIds)
  }
  if (fechaInicio) {
    sql += ` AND m.fecha >= ?`
    params.push(`${fechaInicio} 00:00:00`)
  }
  if (fechaFin) {
    sql += ` AND m.fecha <= ?`
    params.push(`${fechaFin} 23:59:59`)
  }
  sql += ` ORDER BY m.id DESC`

  const result: any = await query(sql, params)
  return result.map((m: any) => ({
    ...m,
    fecha: formatearFechaRespuesta(m.fecha),
    fecha_original_vencimiento: m.fecha_original_vencimiento
      ? formatearFechaRespuesta(m.fecha_original_vencimiento)
      : null,
  }))
}

// Misma resolución que front/lib/deudas.ts: si no hay contraparte enlazada, se infiere de los comentarios
// auto-generados al crear la deuda entre sucursales.
function sucursalDesdeComentarios(deuda: DeudaPendiente): string | undefined {
  const comentarios = deuda.comentarios ?? ''
  const relacion = comentarios.match(/Deuda entre sucursales:\s*(.+?)\s*→\s*(.+?)(?:\.|$)/i)
  if (relacion) {
    const origen = relacion[1].trim()
    const destino = relacion[2].trim()
    return origen === deuda.sucursal_nombre ? destino : origen
  }

  const referencia = comentarios.match(/(?:hacia|recibida de|desde|consumo \(egreso\) a)\s+(.+?)(?:\.|$)/i)
  return referencia?.[1].trim()
}

/** Sucursal contraparte de la deuda, o undefined si es con un tercero. */
export function sucursalRelacionada(deuda: DeudaPendiente): string | undefined {
  return deuda.sucursal_relacionada_nombre || sucursalDesdeComentarios(deuda)
}

/** Préstamo: crédito que esta sucursal otorgó (nos deben). Deuda: lo que esta sucursal debe. */
export function esPrestamo(deuda: DeudaPendiente): boolean {
  return deuda.tipo === 'ingreso'
}

export interface DeudaAgrupada {
  sucursal: string
  esTercero: boolean
  moneda: 'ARS' | 'USD'
  aCobrar: number
  aPagar: number
  balance: number
  movimientos: DeudaPendiente[]
}

export function agruparDeudas(deudas: DeudaPendiente[]): DeudaAgrupada[] {
  const grupos = new Map<string, DeudaAgrupada>()
  for (const deuda of deudas) {
    const relacionada = sucursalRelacionada(deuda)
    const sucursal = relacionada ?? ETIQUETA_TERCEROS
    const moneda = deuda.moneda ?? 'ARS'
    const key = `${relacionada ? 'suc' : 'ter'}-${sucursal}-${moneda}`
    const grupo = grupos.get(key) ?? {
      sucursal,
      esTercero: !relacionada,
      moneda,
      aCobrar: 0,
      aPagar: 0,
      balance: 0,
      movimientos: [],
    }
    const monto = Math.abs(Number(deuda.monto))
    if (esPrestamo(deuda)) grupo.aCobrar += monto
    else grupo.aPagar += monto
    grupo.balance = grupo.aCobrar - grupo.aPagar
    grupo.movimientos.push(deuda)
    grupos.set(key, grupo)
  }
  return Array.from(grupos.values()).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
}

export function situacionDeuda(deuda: DeudaPendiente, esTercero: boolean): string {
  if (esPrestamo(deuda)) return esTercero ? 'Préstamo · nos deben' : 'Préstamo · nos debe'
  return esTercero ? 'Deuda · debemos' : 'Deuda · le debemos'
}
