import { Request, Response } from 'express'
import ExcelJS from 'exceljs'
import { query } from '../config/database'
import { verificarAccesoSucursal } from '../utils/movimientosHelpers'
import { esSuperadmin, getSucursalesDeUsuario } from '../services/authCacheService'
import {
  agruparDeudas,
  esPrestamo,
  obtenerDeudasPendientes,
  situacionDeuda,
  sucursalRelacionada,
} from '../utils/deudasHelpers'

type AlcanceCaja = 'efectivo' | 'banco' | 'ambas'

function sanitizarNombre(nombre: string): string {
  return nombre.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s_-]/g, '').trim()
}

function formatearFechaExcel(fecha: string | Date | null): string {
  if (!fecha) return ''
  const d = fecha instanceof Date ? fecha : new Date(fecha)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function estiloCabecera(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1)
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002868' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } }
  })
  headerRow.height = 22
}

interface Filtros {
  alcance: AlcanceCaja
  fechaInicio?: string
  fechaFin?: string
  searchText?: string
  filtroDeuda?: string
  bancos?: string[]
  filtroChequesPendientes?: boolean
  tipoMovimiento?: string
  tipoSaldo?: string
}

function buildFiltrosClauses(f: Filtros): { clauses: string[]; params: (string | number)[] } {
  const clauses: string[] = []
  const params: (string | number)[] = []

  if (f.fechaInicio) {
    clauses.push('DATE(m.fecha) >= ?')
    params.push(f.fechaInicio)
  }
  if (f.fechaFin) {
    clauses.push('DATE(m.fecha) <= ?')
    params.push(f.fechaFin)
  }
  if (f.searchText) {
    clauses.push('(m.concepto LIKE ? OR c.nombre LIKE ? OR s.nombre LIKE ?)')
    const like = `%${f.searchText}%`
    params.push(like, like, like)
  }
  // El filtro de deudas solo aplica a saldo necesario. En saldo real una deuda es
  // plata que ya salió de la cuenta, así que siempre tiene que estar contemplada
  // (mismo criterio que la vista: el control ni siquiera se muestra en esa pestaña).
  // Nos guiamos por `estado` (no por la columna `saldo`) para usar la misma fuente
  // de verdad que la pantalla: completado = saldo real.
  if (f.filtroDeuda === 'solo_deudas') {
    clauses.push("(m.estado = 'completado' OR m.es_deuda = 1)")
  } else if (f.filtroDeuda === 'sin_deudas') {
    clauses.push("(m.estado = 'completado' OR m.es_deuda = 0 OR m.es_deuda IS NULL)")
  }
  // Los filtros propios de banco no deben descartar los movimientos de efectivo
  // cuando se exportan ambas cajas juntas.
  if (f.bancos && f.bancos.length > 0) {
    const placeholders = f.bancos.map(() => '?').join(', ')
    clauses.push(
      f.alcance === 'ambas'
        ? `(m.tipo_movimiento = 'efectivo' OR m.banco_id IN (${placeholders}))`
        : `m.banco_id IN (${placeholders})`,
    )
    params.push(...f.bancos)
  }
  if (f.filtroChequesPendientes) {
    clauses.push(
      f.alcance === 'ambas'
        ? "(m.tipo_movimiento = 'efectivo' OR (m.numero_cheque IS NOT NULL AND m.estado != ?))"
        : 'm.numero_cheque IS NOT NULL AND m.estado != ?',
    )
    params.push('aprobado')
  }
  if (f.tipoMovimiento && f.tipoMovimiento !== 'todos') {
    clauses.push('m.tipo = ?')
    params.push(f.tipoMovimiento)
  }
  // La pantalla clasifica Saldo Real / Necesario por `estado` (completado / aprobado),
  // no por la columna `saldo`. Esta última se desincroniza al pagar una deuda, así que
  // filtramos por `estado` para que el Excel coincida con lo que se ve en la caja.
  if (f.tipoSaldo && f.tipoSaldo !== 'todos') {
    clauses.push('m.estado = ?')
    params.push(f.tipoSaldo === 'saldo_real' ? 'completado' : 'aprobado')
  }

  return { clauses, params }
}

const NOMBRE_HOJA: Record<AlcanceCaja, string> = {
  efectivo: 'Movimientos Efectivo',
  banco: 'Movimientos Banco',
  ambas: 'Movimientos Efectivo + Banco',
}

const SUFIJO_ARCHIVO: Record<AlcanceCaja, string> = {
  efectivo: '',
  banco: '',
  ambas: ' - Efectivo + Banco',
}

// Determina qué cajas incluir: la propia del endpoint, salvo que se pida "ambas"
function resolverAlcance(cajaParam: string | undefined, cajaBase: 'efectivo' | 'banco'): AlcanceCaja {
  return cajaParam === 'ambas' ? 'ambas' : cajaBase
}

async function generarExcelMovimientos(req: Request, res: Response, cajaBase: 'efectivo' | 'banco') {
  const { sucursalId } = req.params
  const {
    moneda = 'ARS',
    caja,
    fechaInicio,
    fechaFin,
    searchText,
    filtroDeuda,
    bancos: bancosParam,
    filtroChequesPendientes,
    tipoMovimiento,
    tipoSaldo,
  } = req.query as Record<string, string>

  if (!(await verificarAccesoSucursal(req.user!, sucursalId))) {
    return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
  }

  const [sucursal] = (await query('SELECT nombre FROM sucursales WHERE id = ?', [sucursalId])) as any[]
  if (!sucursal) {
    return res.status(404).json({ success: false, message: 'Sucursal no encontrada' })
  }

  const alcance = resolverAlcance(caja, cajaBase)
  const bancos = bancosParam ? bancosParam.split(',').filter(Boolean) : []
  const { clauses, params: filtroParams } = buildFiltrosClauses({
    alcance,
    fechaInicio,
    fechaFin,
    searchText,
    filtroDeuda,
    bancos,
    filtroChequesPendientes: filtroChequesPendientes === 'true',
    tipoMovimiento,
    tipoSaldo,
  })
  const extraWhere = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : ''

  const cajaWhere = alcance === 'ambas' ? "m.tipo_movimiento IN ('efectivo', 'banco')" : 'm.tipo_movimiento = ?'
  const cajaParams = alcance === 'ambas' ? [] : [alcance]

  const rows = (await query(
    `SELECT m.fecha, m.tipo, m.concepto, m.monto,
            m.estado,
            m.tipo_movimiento AS caja,
            c.nombre AS categoria,
            s.nombre AS subcategoria,
            d.nombre AS descripcion_nombre,
            b.nombre AS banco,
            mp.nombre AS medio_pago
     FROM movimientos m
     LEFT JOIN categorias c ON m.categoria_id = c.id
     LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
     LEFT JOIN descripciones d ON m.descripcion_id = d.id
     LEFT JOIN bancos b ON m.banco_id = b.id
     LEFT JOIN medios_pago mp ON m.medio_pago_id = mp.id
     WHERE m.sucursal_id = ?
       AND ${cajaWhere}
       AND m.moneda = ?
       AND m.deleted_at IS NULL
       AND (m.estado IS NULL OR m.estado <> 'pendiente')
       ${extraWhere}
     ORDER BY m.fecha DESC, m.id DESC`,
    [sucursalId, ...cajaParams, moneda, ...filtroParams],
  )) as any[]

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Heroica'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(NOMBRE_HOJA[alcance])
  sheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 14 },
    ...(alcance === 'ambas' ? [{ header: 'Caja', key: 'caja', width: 12 }] : []),
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Concepto', key: 'concepto', width: 36 },
    { header: 'Descripción', key: 'descripcion', width: 36 },
    { header: 'Categoría', key: 'categoria', width: 22 },
    { header: 'Subcategoría', key: 'subcategoria', width: 22 },
    { header: 'Monto', key: 'monto', width: 16 },
    { header: 'Tipo Movimiento', key: 'tipo_movimiento', width: 18 },
    { header: 'Banco', key: 'banco', width: 16 },
    { header: 'Medio de Pago', key: 'medio_pago', width: 18 },
  ]

  for (const m of rows) {
    const esEfectivo = m.caja === 'efectivo'
    const row = sheet.addRow({
      fecha: formatearFechaExcel(m.fecha),
      caja: esEfectivo ? 'Efectivo' : 'Banco',
      tipo: m.tipo,
      concepto: m.concepto || '',
      descripcion: m.descripcion_nombre || '',
      categoria: m.categoria || '',
      subcategoria: m.subcategoria || '',
      monto: Number(m.monto),
      tipo_movimiento: m.estado === 'completado' ? 'Saldo Real' : 'Saldo Necesario',
      banco: esEfectivo ? '' : m.banco || '',
      medio_pago: esEfectivo ? '' : m.medio_pago || '',
    })
    const montoCell = row.getCell('monto')
    montoCell.numFmt = '#,##0.00'
    montoCell.font = { color: { argb: m.tipo === 'egreso' ? 'FFdc2626' : 'FF16a34a' } }
  }

  estiloCabecera(sheet)

  const filename = `${sanitizarNombre(sucursal.nombre)}${SUFIJO_ARCHIVO[alcance]}.xlsx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  await workbook.xlsx.write(res)
  res.end()
}

// GET /api/movimientos/:sucursalId/export
export const exportEfectivoToExcel = async (req: Request, res: Response) => {
  try {
    await generarExcelMovimientos(req, res, 'efectivo')
  } catch (error) {
    console.error('Error en exportEfectivoToExcel:', error)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error al generar el Excel' })
  }
}

// GET /api/caja-banco/:sucursalId/export
export const exportBancoToExcel = async (req: Request, res: Response) => {
  try {
    await generarExcelMovimientos(req, res, 'banco')
  } catch (error) {
    console.error('Error en exportBancoToExcel:', error)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error al generar el Excel' })
  }
}

// GET /api/movimientos/deudas/export
// Deudas y préstamos pendientes de todas las sucursales a las que el usuario tiene acceso, sin filtro de fecha.
// Solo deudas entre sucursales (sin terceros); cada una aparece una vez por cada lado, como la ve cada sucursal.
export const exportDeudasToExcel = async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const sucursalIds = (await esSuperadmin(user.rol_id))
      ? undefined
      : Array.from(await getSucursalesDeUsuario(user.id))

    const deudas = (await obtenerDeudasPendientes({ sucursalIds })).filter(deuda => sucursalRelacionada(deuda))

    const porSucursal = new Map<string, typeof deudas>()
    for (const deuda of deudas) {
      const lista = porSucursal.get(deuda.sucursal_nombre) ?? []
      lista.push(deuda)
      porSucursal.set(deuda.sucursal_nombre, lista)
    }
    const sucursales = Array.from(porSucursal.keys()).sort((a, b) => a.localeCompare(b, 'es'))

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Heroica'
    workbook.created = new Date()

    // El orden de creación define el orden de las solapas: Resumen simplificado, Resumen, Detalle.
    const simplificado = workbook.addWorksheet('Resumen simplificado')
    simplificado.columns = [
      { header: 'Sucursal', key: 'sucursal', width: 24 },
      { header: 'Moneda', key: 'moneda', width: 10 },
      { header: 'A cobrar', key: 'aCobrar', width: 16 },
      { header: 'A pagar', key: 'aPagar', width: 16 },
      { header: 'Neto', key: 'balance', width: 16 },
    ]

    const resumen = workbook.addWorksheet('Resumen')
    resumen.columns = [
      { header: 'Sucursal', key: 'sucursal', width: 24 },
      { header: 'Relacionada con', key: 'relacionada', width: 28 },
      { header: 'Moneda', key: 'moneda', width: 10 },
      { header: 'A cobrar', key: 'aCobrar', width: 16 },
      { header: 'A pagar', key: 'aPagar', width: 16 },
      { header: 'Neto', key: 'balance', width: 16 },
    ]

    const detalle = workbook.addWorksheet('Detalle')
    detalle.columns = [
      { header: 'Sucursal', key: 'sucursal', width: 24 },
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Relacionada con', key: 'relacionada', width: 28 },
      { header: 'Moneda', key: 'moneda', width: 10 },
      { header: 'Descripción', key: 'descripcion', width: 32 },
      { header: 'Observaciones', key: 'comentarios', width: 50 },
      { header: 'Situación', key: 'situacion', width: 22 },
      { header: 'Monto', key: 'monto', width: 16 },
    ]

    const totalesPorSucursal = new Map<string, { sucursal: string; moneda: string; aCobrar: number; aPagar: number }>()

    for (const sucursal of sucursales) {
      for (const grupo of agruparDeudas(porSucursal.get(sucursal)!)) {
        const claveTotal = `${sucursal}-${grupo.moneda}`
        const total = totalesPorSucursal.get(claveTotal) ?? {
          sucursal,
          moneda: grupo.moneda,
          aCobrar: 0,
          aPagar: 0,
        }
        total.aCobrar += grupo.aCobrar
        total.aPagar += grupo.aPagar
        totalesPorSucursal.set(claveTotal, total)

        const filaResumen = resumen.addRow({
          sucursal,
          relacionada: grupo.sucursal,
          moneda: grupo.moneda,
          aCobrar: grupo.aCobrar,
          aPagar: grupo.aPagar,
          balance: grupo.balance,
        })
        for (const key of ['aCobrar', 'aPagar', 'balance']) filaResumen.getCell(key).numFmt = '#,##0.00'
        filaResumen.getCell('balance').font = {
          bold: true,
          color: { argb: grupo.balance >= 0 ? 'FF16a34a' : 'FFdc2626' },
        }

        for (const deuda of grupo.movimientos) {
          const filaDetalle = detalle.addRow({
            sucursal,
            fecha: deuda.fecha ?? '',
            relacionada: grupo.sucursal,
            moneda: grupo.moneda,
            descripcion: deuda.descripcion || 'Sin descripción',
            comentarios: deuda.comentarios || '',
            situacion: situacionDeuda(deuda, grupo.esTercero),
            monto: Math.abs(Number(deuda.monto)),
          })
          const montoCell = filaDetalle.getCell('monto')
          montoCell.numFmt = '#,##0.00'
          montoCell.font = { color: { argb: esPrestamo(deuda) ? 'FF16a34a' : 'FFdc2626' } }
          filaDetalle.getCell('comentarios').alignment = { wrapText: true, vertical: 'top' }
        }
      }
    }

    const totales = Array.from(totalesPorSucursal.values()).sort(
      (a, b) => a.sucursal.localeCompare(b.sucursal, 'es') || a.moneda.localeCompare(b.moneda),
    )
    for (const total of totales) {
      const balance = total.aCobrar - total.aPagar
      const fila = simplificado.addRow({ ...total, balance })
      for (const key of ['aCobrar', 'aPagar', 'balance']) fila.getCell(key).numFmt = '#,##0.00'
      fila.getCell('balance').font = { bold: true, color: { argb: balance >= 0 ? 'FF16a34a' : 'FFdc2626' } }
    }

    for (const sheet of [simplificado, resumen, detalle]) {
      estiloCabecera(sheet)
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } }
    }

    const hoy = formatearFechaExcel(new Date())
    const filename = `Deudas y prestamos - Todas las sucursales ${hoy}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (error) {
    console.error('Error en exportDeudasToExcel:', error)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Error al generar el Excel' })
  }
}
