import { Request, Response } from 'express'
import { query } from '../config/database'
import { sendResumenTesoreriaEmail } from '../services/emailService'
import { formatearFechaRespuesta } from '../utils/movimientosHelpers'

interface MovimientoResumen {
  id: number
  fecha: string
  descripcion: string | null
  comentarios?: string
  monto: number
  tipo: 'ingreso' | 'egreso'
  tipo_movimiento: 'efectivo' | 'banco'
}

interface DiaResumen {
  fecha: string
  movimientos: MovimientoResumen[]
  ingresos: number
  egresos: number
  saldoFinal: number
}

interface ResumenTesoreria {
  sucursal: string
  moneda: string
  dias: DiaResumen[]
}

function fechasReferencia(fechaBase?: string): string[] {
  const hoy = fechaBase && /^\d{4}-\d{2}-\d{2}$/.test(fechaBase) ? new Date(`${fechaBase}T12:00:00`) : new Date()
  return [-1, 0, 1].map(offset => {
    const fecha = new Date(hoy)
    fecha.setDate(hoy.getDate() + offset)
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
  })
}

async function obtenerResumen(
  sucursalId: number,
  moneda: string,
  fechaBase?: string,
): Promise<ResumenTesoreria | null> {
  const sucursales: any = await query('SELECT nombre FROM sucursales WHERE id = ? AND deleted_at IS NULL', [sucursalId])
  if (!Array.isArray(sucursales) || sucursales.length === 0) return null
  const fechas = fechasReferencia(fechaBase)
  const monedaSql = moneda === 'ARS' ? `(moneda = ? OR moneda IS NULL OR moneda = '')` : 'moneda = ?'
  const movimientos: any = await query(
    `SELECT m.id, m.fecha, d.nombre AS descripcion, m.comentarios, m.monto, m.tipo, m.tipo_movimiento
     FROM movimientos m
     LEFT JOIN descripciones d ON m.descripcion_id = d.id
     WHERE m.sucursal_id = ? AND ${monedaSql} AND DATE(m.fecha) BETWEEN ? AND ?
       AND m.deleted_at IS NULL AND (m.estado IS NULL OR m.estado NOT IN ('pendiente', 'rechazado'))
     ORDER BY m.fecha, m.id`,
    [sucursalId, moneda, fechas[0], fechas[2]],
  )
  const saldoAnterior: any = await query(
    `SELECT COALESCE(SUM(monto), 0) AS saldo FROM movimientos
     WHERE sucursal_id = ? AND ${monedaSql} AND DATE(fecha) < ?
       AND deleted_at IS NULL AND (estado IS NULL OR estado NOT IN ('pendiente', 'rechazado'))`,
    [sucursalId, moneda, fechas[0]],
  )
  let saldo = Number(saldoAnterior[0]?.saldo ?? 0)
  const dias = fechas.map(fecha => {
    const items = (movimientos as any[])
      .filter(mov => formatearFechaRespuesta(mov.fecha)?.slice(0, 10) === fecha)
      .map(mov => ({ ...mov, fecha: formatearFechaRespuesta(mov.fecha), monto: Number(mov.monto) }))
    const ingresos = items.filter(mov => mov.tipo === 'ingreso').reduce((total, mov) => total + Math.abs(mov.monto), 0)
    const egresos = items.filter(mov => mov.tipo === 'egreso').reduce((total, mov) => total + Math.abs(mov.monto), 0)
    saldo += ingresos - egresos
    return { fecha, movimientos: items, ingresos, egresos, saldoFinal: saldo }
  })
  return { sucursal: sucursales[0].nombre, moneda, dias }
}

export const getResumenTesoreria = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.query.sucursalId)
    const moneda = String(req.query.moneda ?? 'ARS').toUpperCase()
    if (!Number.isInteger(sucursalId)) return res.status(400).json({ success: false, message: 'Sucursal inválida' })
    const data = await obtenerResumen(sucursalId, moneda, String(req.query.fecha ?? ''))
    if (!data) return res.status(404).json({ success: false, message: 'Sucursal no encontrada' })
    return res.json({ success: true, data })
  } catch (error) {
    console.error('Error al obtener resumen de tesorería:', error)
    return res.status(500).json({ success: false, message: 'Error al obtener el resumen' })
  }
}

export const emailResumenTesoreria = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.body.sucursal_id)
    const moneda = String(req.body.moneda ?? 'ARS').toUpperCase()
    const destinatario = String(req.body.destinatario ?? '').trim()
    if (!Number.isInteger(sucursalId) || !/^\S+@\S+\.\S+$/.test(destinatario)) {
      return res.status(400).json({ success: false, message: 'Sucursal o email inválido' })
    }
    const data = await obtenerResumen(sucursalId, moneda, String(req.body.fecha ?? ''))
    if (!data) return res.status(404).json({ success: false, message: 'Sucursal no encontrada' })
    await sendResumenTesoreriaEmail(destinatario, data)
    return res.json({ success: true, message: 'Resumen enviado por email' })
  } catch (error) {
    console.error('Error al enviar resumen de tesorería:', error)
    return res.status(500).json({ success: false, message: 'No se pudo enviar el resumen' })
  }
}
