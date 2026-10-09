import { Request, Response } from 'express'
import ExcelJS from 'exceljs'
import { query } from '../config/database'
import { FUENTES_VENTAS, type FuenteVentas } from '../services/ventas/types'
import { construirWhereVentas, FiltrosVentas, parsearFiltrosVentas, responderErrorVentas } from '../utils/ventasFiltros'

const POR_PAGINA = 50
const MAX_FILAS_EXCEL = 100_000

interface FilaOperacion {
  fuente: string
  fecha: string
  transaccion_id: string
  fecha_hora: string | null
  sucursal_id: number | null
  sucursal: string | null
  local_externo: string | null
  total: string | number
  cobrado: string | number
  unidades: string | number
  medios_pago: string | null
  canal: string | null
  documento: string | null
  tipo_documento: string | null
  vendedor: string | null
  caja: string | null
  anulada: number
  observada: number
}

/** Una operación = todas las líneas de una transacción de un día operativo. */
function sqlOperaciones(filtros: FiltrosVentas) {
  const { where, params } = construirWhereVentas(filtros, 'todas', { incluirAnuladas: true })
  const sql = `
    SELECT l.fuente, DATE_FORMAT(l.fecha, '%Y-%m-%d') AS fecha, l.transaccion_id,
           DATE_FORMAT(MIN(l.fecha_hora), '%Y-%m-%d %H:%i:%s') AS fecha_hora,
           MAX(l.sucursal_id) AS sucursal_id, MAX(s.nombre) AS sucursal, MAX(le.nombre_externo) AS local_externo,
           SUM(CASE WHEN l.tipo_linea IN ('producto', 'descuento') THEN l.importe ELSE 0 END) AS total,
           SUM(CASE WHEN l.tipo_linea = 'pago' THEN l.importe ELSE 0 END) AS cobrado,
           SUM(CASE WHEN l.tipo_linea = 'producto' THEN l.cantidad ELSE 0 END) AS unidades,
           GROUP_CONCAT(DISTINCT CASE WHEN l.tipo_linea = 'pago' THEN l.medio_pago END
                        ORDER BY l.medio_pago SEPARATOR ', ') AS medios_pago,
           MAX(l.canal) AS canal, MAX(l.documento) AS documento, MAX(l.tipo_documento) AS tipo_documento,
           MAX(l.vendedor) AS vendedor, MAX(l.caja) AS caja,
           MAX(l.anulada) AS anulada, MAX(l.observada) AS observada
    FROM ventas_lineas l
    LEFT JOIN sucursales s ON s.id = l.sucursal_id
    LEFT JOIN ventas_locales_externos le ON le.id = l.local_externo_id
    WHERE ${where}
    GROUP BY l.fuente, l.fecha, l.transaccion_id`
  return { sql, params }
}

function mapearOperacion(f: FilaOperacion) {
  return {
    fuente: f.fuente,
    fecha: f.fecha,
    transaccionId: f.transaccion_id,
    fechaHora: f.fecha_hora,
    sucursalId: f.sucursal_id,
    sucursal: f.sucursal,
    localExterno: f.local_externo,
    total: Number(f.total),
    cobrado: Number(f.cobrado),
    unidades: Number(f.unidades),
    mediosPago: f.medios_pago,
    canal: f.canal,
    documento: f.documento,
    tipoDocumento: f.tipo_documento,
    vendedor: f.vendedor,
    caja: f.caja,
    anulada: Boolean(f.anulada),
    observada: Boolean(f.observada),
  }
}

/** GET /api/ventas/operaciones — mismos filtros que el panel + &pagina=1 */
export const getOperaciones = async (req: Request, res: Response) => {
  try {
    const filtros = await parsearFiltrosVentas(req)
    const pagina = Math.max(1, Math.floor(Number(req.query.pagina) || 1))
    const { sql, params } = sqlOperaciones(filtros)

    const [filas, conteo] = await Promise.all([
      query(
        `${sql} ORDER BY l.fecha DESC, fecha_hora DESC LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`,
        params,
      ),
      query(`SELECT COUNT(*) AS total FROM (${sql}) t`, params),
    ])

    const total = Number((conteo as Array<{ total: number }>)[0]?.total ?? 0)
    res.json({
      success: true,
      data: {
        operaciones: (filas as FilaOperacion[]).map(mapearOperacion),
        paginacion: { pagina, porPagina: POR_PAGINA, total, totalPaginas: Math.max(1, Math.ceil(total / POR_PAGINA)) },
      },
    })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'getOperaciones')
  }
}

/** GET /api/ventas/operaciones/detalle?fuente&fecha&transaccion_id */
export const getDetalleOperacion = async (req: Request, res: Response) => {
  try {
    const fuente = String(req.query.fuente ?? '')
    const fecha = String(req.query.fecha ?? '')
    const transaccionId = String(req.query.transaccion_id ?? '')
    if (!FUENTES_VENTAS.includes(fuente as FuenteVentas) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !transaccionId) {
      res.status(400).json({ success: false, message: 'Operación inválida' })
      return
    }

    const filtros = await parsearFiltrosVentas(req, { desde: fecha, hasta: fecha })
    const { where, params } = construirWhereVentas(filtros, 'todas', { incluirAnuladas: true })
    const lineas = (await query(
      `SELECT l.id, l.tipo_linea, l.producto_codigo, l.producto_nombre, l.categoria, l.cantidad, l.precio_unitario,
              l.importe, l.descuento, l.medio_pago, l.canal, l.vendedor, l.caja, l.estado_origen, l.anulada,
              DATE_FORMAT(l.fecha_hora, '%Y-%m-%d %H:%i:%s') AS fecha_hora
       FROM ventas_lineas l
       WHERE ${where} AND l.fuente = ? AND l.transaccion_id = ?
       ORDER BY l.tipo_linea DESC, l.id`,
      [...params, fuente, transaccionId],
    )) as Array<Record<string, unknown>>

    if (lineas.length === 0) {
      res.status(404).json({ success: false, message: 'Operación no encontrada' })
      return
    }

    res.json({
      success: true,
      data: lineas.map(l => ({
        id: Number(l.id),
        tipoLinea: l.tipo_linea,
        productoCodigo: l.producto_codigo,
        productoNombre: l.producto_nombre,
        categoria: l.categoria,
        cantidad: Number(l.cantidad),
        precioUnitario: l.precio_unitario === null ? null : Number(l.precio_unitario),
        importe: Number(l.importe),
        descuento: Number(l.descuento),
        medioPago: l.medio_pago,
        canal: l.canal,
        vendedor: l.vendedor,
        caja: l.caja,
        estadoOrigen: l.estado_origen,
        anulada: Boolean(l.anulada),
        fechaHora: l.fecha_hora,
      })),
    })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'getDetalleOperacion')
  }
}

function estiloCabecera(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1)
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002868' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  header.height = 22
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

/** GET /api/ventas/exportar — Excel con operaciones y detalle de líneas. */
export const exportarVentasExcel = async (req: Request, res: Response) => {
  try {
    const filtros = await parsearFiltrosVentas(req)
    const ops = sqlOperaciones(filtros)
    const det = construirWhereVentas(filtros, 'todas', { incluirAnuladas: true })

    const [operaciones, lineas] = await Promise.all([
      query(`${ops.sql} ORDER BY l.fecha, fecha_hora LIMIT ${MAX_FILAS_EXCEL}`, ops.params),
      query(
        `SELECT DATE_FORMAT(l.fecha, '%Y-%m-%d') AS fecha, DATE_FORMAT(l.fecha_hora, '%Y-%m-%d %H:%i') AS fecha_hora,
                COALESCE(s.nombre, 'Sin asignar') AS sucursal, COALESCE(l.documento, l.transaccion_id) AS documento,
                l.tipo_linea, l.producto_codigo, l.producto_nombre, l.categoria, l.cantidad, l.importe, l.descuento,
                l.medio_pago, l.canal, l.vendedor, l.caja, l.anulada
         FROM ventas_lineas l LEFT JOIN sucursales s ON s.id = l.sucursal_id
         WHERE ${det.where} ORDER BY l.fecha, l.fecha_hora, l.transaccion_id LIMIT ${MAX_FILAS_EXCEL}`,
        det.params,
      ),
    ])

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Heroica'

    const hojaOps = workbook.addWorksheet('Operaciones')
    hojaOps.columns = [
      { header: 'Día operativo', key: 'fecha', width: 14 },
      { header: 'Hora', key: 'fechaHora', width: 18 },
      { header: 'Sucursal', key: 'sucursal', width: 24 },
      { header: 'Documento', key: 'documento', width: 18 },
      { header: 'Tipo', key: 'tipoDocumento', width: 14 },
      { header: 'Total', key: 'total', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Cobrado', key: 'cobrado', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Unidades', key: 'unidades', width: 10 },
      { header: 'Medios de pago', key: 'mediosPago', width: 28 },
      { header: 'Canal', key: 'canal', width: 16 },
      { header: 'Vendedor', key: 'vendedor', width: 20 },
      { header: 'Caja', key: 'caja', width: 12 },
      { header: 'Anulada', key: 'anulada', width: 10 },
    ]
    for (const op of (operaciones as FilaOperacion[]).map(mapearOperacion)) {
      hojaOps.addRow({
        ...op,
        documento: op.documento ?? op.transaccionId,
        sucursal: op.sucursal ?? `Sin asignar (${op.localExterno ?? '—'})`,
        anulada: op.anulada ? 'Sí' : '',
      })
    }
    estiloCabecera(hojaOps)

    const hojaLineas = workbook.addWorksheet('Detalle')
    hojaLineas.columns = [
      { header: 'Día operativo', key: 'fecha', width: 14 },
      { header: 'Hora', key: 'fecha_hora', width: 18 },
      { header: 'Sucursal', key: 'sucursal', width: 24 },
      { header: 'Documento', key: 'documento', width: 18 },
      { header: 'Tipo', key: 'tipo_linea', width: 10 },
      { header: 'Código', key: 'producto_codigo', width: 14 },
      { header: 'Producto', key: 'producto_nombre', width: 32 },
      { header: 'Categoría', key: 'categoria', width: 20 },
      { header: 'Cantidad', key: 'cantidad', width: 10 },
      { header: 'Importe', key: 'importe', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Descuento', key: 'descuento', width: 12, style: { numFmt: '#,##0.00' } },
      { header: 'Medio de pago', key: 'medio_pago', width: 20 },
      { header: 'Canal', key: 'canal', width: 16 },
      { header: 'Vendedor', key: 'vendedor', width: 20 },
      { header: 'Caja', key: 'caja', width: 12 },
      { header: 'Anulada', key: 'anulada', width: 10 },
    ]
    for (const l of lineas as Array<Record<string, unknown>>) {
      hojaLineas.addRow({
        ...l,
        cantidad: Number(l.cantidad),
        importe: Number(l.importe),
        descuento: Number(l.descuento),
        anulada: l.anulada ? 'Sí' : '',
      })
    }
    estiloCabecera(hojaLineas)

    const filename = `Ventas_${filtros.desde}_a_${filtros.hasta}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'exportarVentasExcel')
  }
}
