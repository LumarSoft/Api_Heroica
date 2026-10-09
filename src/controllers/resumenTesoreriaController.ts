import { Request, Response } from 'express'
import { query } from '../config/database'
import { sendResumenTesoreriaEmail } from '../services/emailService'
import { esSuperadmin, getSucursalesDeUsuario } from '../services/authCacheService'
import { formatearFechaRespuesta } from '../utils/movimientosHelpers'

type Caja = 'efectivo' | 'banco'

interface MovimientoResumen {
  id: number
  fecha: string
  descripcion: string | null
  comentarios?: string
  monto: number
  tipo: 'ingreso' | 'egreso'
  tipo_movimiento: Caja
  estado: 'completado' | 'aprobado'
  banco: string | null
}

interface DiaResumen {
  fecha: string
  movimientos: MovimientoResumen[]
  ingresos: number
  egresos: number
}

interface SaldosCaja {
  /** Igual a "Total Saldo Real" de la caja (movimientos completados). */
  real: number
  /** Igual a "Saldo Necesario" de la caja: real + aprobados que no son deuda. */
  necesario: number
}

interface SucursalResumen {
  sucursalId: number
  sucursal: string
  saldos: { efectivo: SaldosCaja; banco: SaldosCaja; total: SaldosCaja }
  bancos: Array<{ banco: string; real: number; necesario: number }>
  dias: DiaResumen[]
}

export interface ResumenTesoreria {
  alcance: 'sucursal' | 'todas'
  moneda: string
  fecha: string
  sucursales: SucursalResumen[]
  totales: { efectivo: SaldosCaja; banco: SaldosCaja; total: SaldosCaja }
}

// Mismos criterios que getTotalesEfectivo / getTotalesBanco: los saldos tienen que coincidir
// con lo que se ve en Caja efectivo y Caja banco.
const SUMA_REAL = `SUM(CASE WHEN m.estado = 'completado' THEN m.monto ELSE 0 END)`
const SUMA_NECESARIO = `SUM(CASE WHEN m.estado = 'aprobado' AND (m.es_deuda = 0 OR m.es_deuda IS NULL) THEN m.monto ELSE 0 END)`

function fechasReferencia(fechaBase?: string): string[] {
  const hoy = fechaBase && /^\d{4}-\d{2}-\d{2}$/.test(fechaBase) ? new Date(`${fechaBase}T12:00:00`) : new Date()
  return [-1, 0, 1].map(offset => {
    const fecha = new Date(hoy)
    fecha.setDate(hoy.getDate() + offset)
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
  })
}

const saldosVacios = (): SaldosCaja => ({ real: 0, necesario: 0 })

async function sucursalesPermitidas(
  user: any,
  sucursalId: number | null,
): Promise<Array<{ id: number; nombre: string }>> {
  const rows: any = await query(
    `SELECT id, nombre FROM sucursales WHERE deleted_at IS NULL ${sucursalId === null ? 'AND activo = 1' : 'AND id = ?'} ORDER BY nombre`,
    sucursalId === null ? [] : [sucursalId],
  )
  if (await esSuperadmin(user.rol_id)) return rows
  const asignadas = await getSucursalesDeUsuario(user.id)
  return (rows as any[]).filter(row => asignadas.has(Number(row.id)))
}

async function obtenerResumen(
  user: any,
  sucursalId: number | null,
  moneda: string,
  fechaBase?: string,
): Promise<ResumenTesoreria | null> {
  const sucursales = await sucursalesPermitidas(user, sucursalId)
  const fechas = fechasReferencia(fechaBase)
  const totales = { efectivo: saldosVacios(), banco: saldosVacios(), total: saldosVacios() }
  if (sucursales.length === 0) {
    return sucursalId === null ? { alcance: 'todas', moneda, fecha: fechas[1], sucursales: [], totales } : null
  }
  const ids = sucursales.map(s => s.id)
  const placeholders = ids.map(() => '?').join(', ')

  const saldosRows: any = await query(
    `SELECT m.sucursal_id, m.tipo_movimiento, COALESCE(b.nombre, 'Sin banco') AS banco,
            ${SUMA_REAL} AS total_real, ${SUMA_NECESARIO} AS total_necesario
     FROM movimientos m
     LEFT JOIN bancos b ON m.banco_id = b.id
     WHERE m.sucursal_id IN (${placeholders}) AND m.moneda = ? AND m.deleted_at IS NULL
       AND m.tipo_movimiento IN ('efectivo', 'banco')
     GROUP BY m.sucursal_id, m.tipo_movimiento, b.id, b.nombre`,
    [...ids, moneda],
  )

  // Movimientos del día que forman parte de algún saldo (real o necesario). Las deudas aprobadas
  // y las solicitudes pendientes quedan afuera, igual que en los totales de las cajas.
  const movimientos: any = await query(
    `SELECT m.id, m.sucursal_id, m.fecha, d.nombre AS descripcion, m.comentarios, m.monto, m.tipo_movimiento,
            m.estado, b.nombre AS banco
     FROM movimientos m
     LEFT JOIN descripciones d ON m.descripcion_id = d.id
     LEFT JOIN bancos b ON m.banco_id = b.id
     WHERE m.sucursal_id IN (${placeholders}) AND m.moneda = ? AND m.deleted_at IS NULL
       AND m.tipo_movimiento IN ('efectivo', 'banco')
       AND DATE(m.fecha) BETWEEN ? AND ?
       AND (m.estado = 'completado' OR (m.estado = 'aprobado' AND (m.es_deuda = 0 OR m.es_deuda IS NULL)))
     ORDER BY m.fecha, m.tipo_movimiento, m.id`,
    [...ids, moneda, fechas[0], fechas[2]],
  )

  const resultado = sucursales.map<SucursalResumen>(sucursal => {
    const saldos = { efectivo: saldosVacios(), banco: saldosVacios(), total: saldosVacios() }
    const bancos: SucursalResumen['bancos'] = []
    for (const row of (saldosRows as any[]).filter(r => Number(r.sucursal_id) === sucursal.id)) {
      const caja = row.tipo_movimiento as Caja
      const real = Number(row.total_real ?? 0)
      const necesario = real + Number(row.total_necesario ?? 0)
      saldos[caja].real += real
      saldos[caja].necesario += necesario
      if (caja === 'banco') bancos.push({ banco: row.banco, real, necesario })
    }
    saldos.total.real = saldos.efectivo.real + saldos.banco.real
    saldos.total.necesario = saldos.efectivo.necesario + saldos.banco.necesario
    for (const clave of ['efectivo', 'banco', 'total'] as const) {
      totales[clave].real += saldos[clave].real
      totales[clave].necesario += saldos[clave].necesario
    }

    const propios = (movimientos as any[]).filter(mov => Number(mov.sucursal_id) === sucursal.id)
    const dias = fechas.map(fecha => {
      const items: MovimientoResumen[] = propios
        .filter(mov => formatearFechaRespuesta(mov.fecha) === fecha)
        .map(mov => {
          const monto = Number(mov.monto)
          return {
            id: mov.id,
            fecha,
            descripcion: mov.descripcion,
            comentarios: mov.comentarios ?? undefined,
            monto,
            // El signo del monto es lo que impacta en el saldo; se usa también para clasificar.
            tipo: monto < 0 ? 'egreso' : 'ingreso',
            tipo_movimiento: mov.tipo_movimiento,
            estado: mov.estado,
            banco: mov.banco ?? null,
          }
        })
      const ingresos = items.filter(mov => mov.monto >= 0).reduce((total, mov) => total + mov.monto, 0)
      const egresos = items.filter(mov => mov.monto < 0).reduce((total, mov) => total + Math.abs(mov.monto), 0)
      return { fecha, movimientos: items, ingresos, egresos }
    })

    return { sucursalId: sucursal.id, sucursal: sucursal.nombre, saldos, bancos, dias }
  })

  // Evita el ruido de punto flotante de las sumas (ej. 8083679.430000001).
  const centavos = (valores: SaldosCaja) => {
    valores.real = Math.round(valores.real * 100) / 100
    valores.necesario = Math.round(valores.necesario * 100) / 100
  }
  for (const sucursal of resultado) {
    Object.values(sucursal.saldos).forEach(centavos)
    sucursal.bancos.forEach(centavos)
  }
  Object.values(totales).forEach(centavos)

  return {
    alcance: sucursalId === null ? 'todas' : 'sucursal',
    moneda,
    fecha: fechas[1],
    sucursales: resultado,
    totales,
  }
}

/** `sucursalId` numérico → una sucursal; `todas` (o vacío) → todas las sucursales activas a las que accede el usuario. */
function parsearSucursal(valor: unknown): number | null | undefined {
  if (valor === undefined || valor === null || valor === '' || valor === 'todas') return null
  const id = Number(valor)
  return Number.isInteger(id) && id > 0 ? id : undefined
}

function parsearDestinatarios(valor: unknown): string[] | null {
  const lista = (Array.isArray(valor) ? valor : String(valor ?? '').split(/[,;\s]+/))
    .map(email => String(email).trim().toLowerCase())
    .filter(Boolean)
  const unicos = [...new Set(lista)]
  if (unicos.length === 0 || unicos.length > 50) return null
  return unicos.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ? unicos : null
}

export const getResumenTesoreria = async (req: Request, res: Response) => {
  try {
    const sucursalId = parsearSucursal(req.query.sucursalId)
    const moneda = String(req.query.moneda ?? 'ARS').toUpperCase()
    if (sucursalId === undefined) return res.status(400).json({ success: false, message: 'Sucursal inválida' })
    const data = await obtenerResumen(req.user!, sucursalId, moneda, String(req.query.fecha ?? ''))
    if (!data) return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    return res.json({ success: true, data })
  } catch (error) {
    console.error('Error al obtener resumen de tesorería:', error)
    return res.status(500).json({ success: false, message: 'Error al obtener el resumen' })
  }
}

export const emailResumenTesoreria = async (req: Request, res: Response) => {
  try {
    const sucursalId = parsearSucursal(req.body.sucursal_id)
    const moneda = String(req.body.moneda ?? 'ARS').toUpperCase()
    const destinatarios = parsearDestinatarios(req.body.destinatarios ?? req.body.destinatario)
    const comentario = String(req.body.comentario ?? '')
      .trim()
      .slice(0, 2000)
    if (sucursalId === undefined) return res.status(400).json({ success: false, message: 'Sucursal inválida' })
    if (!destinatarios) return res.status(400).json({ success: false, message: 'Revisá los emails de destino' })
    const data = await obtenerResumen(req.user!, sucursalId, moneda, String(req.body.fecha ?? ''))
    if (!data) return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    await sendResumenTesoreriaEmail(destinatarios, data, comentario)
    return res.json({ success: true, message: `Resumen enviado a ${destinatarios.length} destinatario(s)` })
  } catch (error) {
    console.error('Error al enviar resumen de tesorería:', error)
    return res.status(500).json({ success: false, message: 'No se pudo enviar el resumen' })
  }
}
