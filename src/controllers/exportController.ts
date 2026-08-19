import { Request, Response } from 'express'
import ExcelJS from 'exceljs'
import { query } from '../config/database'
import { verificarAccesoSucursal } from '../utils/movimientosHelpers'

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
