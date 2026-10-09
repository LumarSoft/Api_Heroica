import { Request, Response } from 'express'
import ExcelJS from 'exceljs'
import type { ResultSetHeader } from 'mysql2/promise'
import { query } from '../config/database'
import { getPermisosDeRol, getRolNombre } from '../services/authCacheService'
import { analizarProductos, analizarVendedores, mapaDeCalor } from '../services/ventas/analisis'
import {
  agregarHojaReporte,
  DIMENSIONES,
  ejecutarReporte,
  METRICAS,
  resolverPeriodo,
  validarConfigReporte,
  type ConfigReporte,
} from '../services/ventas/reportes'
import {
  enviarProgramado,
  mapearProgramado,
  parsearDestinatarios,
  periodoDeEnvio,
  ahoraArgentina,
  type Frecuencia,
} from '../services/ventas/reportesProgramadosService'
import { FiltroInvalidoError, parsearFiltrosVentas, responderErrorVentas } from '../utils/ventasFiltros'

const PERMISO_GESTIONAR = 'gestionar_reportes_ventas'

async function puedeGestionar(req: Request): Promise<boolean> {
  if (!req.user) return false
  if ((await getRolNombre(req.user.rol_id)) === 'superadmin') return true
  return (await getPermisosDeRol(req.user.rol_id)).has(PERMISO_GESTIONAR)
}

/** Filtros del reporte: período (del body o el guardado) + filtros + alcance del usuario. */
async function filtrosDeReporte(req: Request, config: ConfigReporte) {
  const body = (req.body ?? {}) as Record<string, unknown>
  const rango =
    typeof body.desde === 'string' && typeof body.hasta === 'string'
      ? { desde: body.desde, hasta: body.hasta }
      : resolverPeriodo(config.periodo)
  return parsearFiltrosVentas(req, undefined, { ...config.filtros, ...rango })
}

/** GET /api/ventas/reportes/definiciones — dimensiones y métricas disponibles. */
export const getDefinicionesReportes = (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      dimensiones: Object.entries(DIMENSIONES).map(([clave, d]) => ({
        clave,
        etiqueta: d.etiqueta,
        temporal: Boolean(d.temporal),
        soloPago: Boolean(d.soloPago),
        deProducto: Boolean(d.deProducto),
      })),
      metricas: Object.entries(METRICAS).map(([clave, m]) => ({
        clave,
        etiqueta: m.etiqueta,
        formato: m.formato,
        deProducto: Boolean(m.deProducto),
      })),
    },
  })
}

/** POST /api/ventas/reportes/consulta { ...config, desde?, hasta? } */
export const postConsultaReporte = async (req: Request, res: Response) => {
  try {
    const config = validarConfigReporte(req.body)
    const filtros = await filtrosDeReporte(req, config)
    res.json({ success: true, data: await ejecutarReporte(filtros, config) })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'postConsultaReporte')
  }
}

/** POST /api/ventas/reportes/exportar { ...config, desde?, hasta?, nombre? } → Excel */
export const postExportarReporte = async (req: Request, res: Response) => {
  try {
    const config = validarConfigReporte(req.body)
    const filtros = await filtrosDeReporte(req, config)
    const resultado = await ejecutarReporte(filtros, { ...config, limite: 5000 })
    const nombre =
      typeof req.body?.nombre === 'string' && req.body.nombre.trim()
        ? req.body.nombre.trim().slice(0, 80)
        : 'Reporte de ventas'
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Heroica'
    const filtrosTexto = Object.entries(config.filtros)
      .filter(([k, v]) => k !== 'sucursal_ids' && v)
      .map(([k, v]) => `${k.replace('_', ' ')}: ${v}`)
    agregarHojaReporte(workbook, nombre, resultado, [
      `Período: ${filtros.desde} al ${filtros.hasta}${resultado.periodoComparado ? ` · comparado con ${resultado.periodoComparado.desde} al ${resultado.periodoComparado.hasta}` : ''}`,
      ...(filtrosTexto.length ? [`Filtros: ${filtrosTexto.join(' · ')}`] : []),
      ...resultado.avisos,
    ])
    const archivo = `${nombre.replace(/[^\w\- ]+/g, '').trim() || 'Reporte'}_${filtros.desde}_a_${filtros.hasta}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(archivo)}`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'postExportarReporte')
  }
}

// ─── Reportes guardados ───────────────────────────────────────────────────────

function mapearGuardado(f: Record<string, unknown>, userId: number) {
  return {
    id: Number(f.id),
    nombre: String(f.nombre),
    descripcion: (f.descripcion as string | null) ?? null,
    config: validarConfigReporte(typeof f.config === 'string' ? JSON.parse(f.config) : f.config),
    compartido: Boolean(f.compartido),
    propio: Number(f.user_id) === userId,
    autor: (f.autor as string | null) ?? null,
    actualizadoAt: f.updated_at,
  }
}

/** GET /api/ventas/reportes/guardados — propios + compartidos. */
export const getReportesGuardados = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const filas = (await query(
      `SELECT r.*, u.nombre AS autor FROM ventas_reportes_guardados r LEFT JOIN usuarios u ON u.id = r.user_id
       WHERE r.user_id = ? OR r.compartido = 1 ORDER BY r.compartido DESC, r.nombre`,
      [userId],
    )) as Array<Record<string, unknown>>
    res.json({ success: true, data: filas.map(f => mapearGuardado(f, userId)) })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'getReportesGuardados')
  }
}

function datosGuardado(body: Record<string, unknown>) {
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim().slice(0, 120) : ''
  if (!nombre) throw new FiltroInvalidoError('El reporte necesita un nombre')
  const descripcion =
    typeof body.descripcion === 'string' && body.descripcion.trim() ? body.descripcion.trim().slice(0, 255) : null
  return { nombre, descripcion, config: validarConfigReporte(body.config), compartido: body.compartido === true }
}

/** POST /api/ventas/reportes/guardados { nombre, descripcion?, config, compartido? } */
export const postReporteGuardado = async (req: Request, res: Response) => {
  try {
    const datos = datosGuardado(req.body ?? {})
    if (datos.compartido && !(await puedeGestionar(req))) {
      res.status(403).json({ success: false, message: 'No tenés permiso para compartir reportes' })
      return
    }
    const r = (await query(
      'INSERT INTO ventas_reportes_guardados (nombre, descripcion, config, compartido, user_id) VALUES (?, ?, ?, ?, ?)',
      [datos.nombre, datos.descripcion, JSON.stringify(datos.config), datos.compartido ? 1 : 0, req.user!.id],
    )) as ResultSetHeader
    res.status(201).json({ success: true, message: 'Reporte guardado', data: { id: r.insertId } })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'postReporteGuardado')
  }
}

async function guardadoEditable(req: Request, res: Response): Promise<Record<string, unknown> | null> {
  const id = Number(req.params.id)
  const [fila] = (await query('SELECT * FROM ventas_reportes_guardados WHERE id = ?', [id])) as Array<
    Record<string, unknown>
  >
  if (!fila) {
    res.status(404).json({ success: false, message: 'Reporte no encontrado' })
    return null
  }
  if (Number(fila.user_id) !== req.user!.id && !(await puedeGestionar(req))) {
    res.status(403).json({ success: false, message: 'Solo quien creó el reporte puede modificarlo' })
    return null
  }
  return fila
}

/** PUT /api/ventas/reportes/guardados/:id */
export const putReporteGuardado = async (req: Request, res: Response) => {
  try {
    const fila = await guardadoEditable(req, res)
    if (!fila) return
    const datos = datosGuardado(req.body ?? {})
    if (datos.compartido && !fila.compartido && !(await puedeGestionar(req))) {
      res.status(403).json({ success: false, message: 'No tenés permiso para compartir reportes' })
      return
    }
    await query(
      'UPDATE ventas_reportes_guardados SET nombre = ?, descripcion = ?, config = ?, compartido = ? WHERE id = ?',
      [datos.nombre, datos.descripcion, JSON.stringify(datos.config), datos.compartido ? 1 : 0, fila.id],
    )
    res.json({ success: true, message: 'Reporte actualizado' })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'putReporteGuardado')
  }
}

/** DELETE /api/ventas/reportes/guardados/:id */
export const deleteReporteGuardado = async (req: Request, res: Response) => {
  try {
    const fila = await guardadoEditable(req, res)
    if (!fila) return
    await query('DELETE FROM ventas_reportes_guardados WHERE id = ?', [fila.id])
    res.json({ success: true, message: 'Reporte eliminado' })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'deleteReporteGuardado')
  }
}

// ─── Análisis ─────────────────────────────────────────────────────────────────

/** GET /api/ventas/productos — curva ABC, tendencias, nuevos y discontinuados. */
export const getAnalisisProductos = async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await analizarProductos(await parsearFiltrosVentas(req)) })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'getAnalisisProductos')
  }
}

/** GET /api/ventas/mapa-calor — día de la semana × hora. */
export const getMapaCalor = async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await mapaDeCalor(await parsearFiltrosVentas(req)) })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'getMapaCalor')
  }
}

/** GET /api/ventas/vendedores — desempeño por vendedor y por caja. */
export const getVendedores = async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await analizarVendedores(await parsearFiltrosVentas(req)) })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'getVendedores')
  }
}

// ─── Envíos programados por mail ──────────────────────────────────────────────

/** GET /api/ventas/reportes/programados */
export const getProgramados = async (_req: Request, res: Response) => {
  try {
    const filas = (await query(
      `SELECT p.*, r.nombre AS reporte_nombre FROM ventas_reportes_programados p
       LEFT JOIN ventas_reportes_guardados r ON r.id = p.reporte_guardado_id ORDER BY p.nombre`,
    )) as Array<Record<string, unknown>>
    const ahora = ahoraArgentina()
    res.json({
      success: true,
      data: filas.map(f => {
        const p = mapearProgramado(f)
        return {
          ...p,
          reporteNombre: (f.reporte_nombre as string | null) ?? null,
          proximoPeriodo: periodoDeEnvio(p.frecuencia, ahora.fecha).etiqueta,
        }
      }),
    })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'getProgramados')
  }
}

function datosProgramado(body: Record<string, unknown>) {
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim().slice(0, 120) : ''
  if (!nombre) throw new FiltroInvalidoError('El envío necesita un nombre')
  const frecuencia = ['diaria', 'semanal', 'mensual'].includes(String(body.frecuencia))
    ? (body.frecuencia as Frecuencia)
    : null
  if (!frecuencia) throw new FiltroInvalidoError('Frecuencia inválida')
  const diaSemana = frecuencia === 'semanal' ? Number(body.diaSemana) : null
  if (diaSemana !== null && (!Number.isInteger(diaSemana) || diaSemana < 1 || diaSemana > 7)) {
    throw new FiltroInvalidoError('Elegí el día de la semana del envío')
  }
  const hora = Number(body.hora ?? 8)
  if (!Number.isInteger(hora) || hora < 0 || hora > 23) throw new FiltroInvalidoError('La hora debe estar entre 0 y 23')
  const destinatarios = parsearDestinatarios(body.destinatarios)
  if (destinatarios.length === 0) throw new FiltroInvalidoError('Ingresá al menos un email válido')
  if (destinatarios.length > 30) throw new FiltroInvalidoError('Hasta 30 destinatarios por envío')
  const sucursalIds = (Array.isArray(body.sucursalIds) ? body.sucursalIds : [])
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
  const reporte =
    body.reporteGuardadoId === null || body.reporteGuardadoId === undefined || body.reporteGuardadoId === ''
      ? null
      : Number(body.reporteGuardadoId)
  return {
    nombre,
    frecuencia,
    diaSemana,
    hora,
    destinatarios: destinatarios.join(', '),
    sucursalIds: sucursalIds.length ? JSON.stringify(sucursalIds) : null,
    reporte: reporte && Number.isInteger(reporte) && reporte > 0 ? reporte : null,
    activo: body.activo !== false,
  }
}

/** POST /api/ventas/reportes/programados */
export const postProgramado = async (req: Request, res: Response) => {
  try {
    const d = datosProgramado(req.body ?? {})
    const r = (await query(
      `INSERT INTO ventas_reportes_programados (nombre, frecuencia, dia_semana, hora, destinatarios, sucursal_ids, reporte_guardado_id, activo, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.nombre,
        d.frecuencia,
        d.diaSemana,
        d.hora,
        d.destinatarios,
        d.sucursalIds,
        d.reporte,
        d.activo ? 1 : 0,
        req.user!.id,
      ],
    )) as ResultSetHeader
    res.status(201).json({ success: true, message: 'Envío programado', data: { id: r.insertId } })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'postProgramado')
  }
}

/** PUT /api/ventas/reportes/programados/:id */
export const putProgramado = async (req: Request, res: Response) => {
  try {
    const d = datosProgramado(req.body ?? {})
    const r = (await query(
      `UPDATE ventas_reportes_programados SET nombre = ?, frecuencia = ?, dia_semana = ?, hora = ?, destinatarios = ?,
              sucursal_ids = ?, reporte_guardado_id = ?, activo = ? WHERE id = ?`,
      [
        d.nombre,
        d.frecuencia,
        d.diaSemana,
        d.hora,
        d.destinatarios,
        d.sucursalIds,
        d.reporte,
        d.activo ? 1 : 0,
        Number(req.params.id),
      ],
    )) as ResultSetHeader
    if (r.affectedRows === 0) {
      res.status(404).json({ success: false, message: 'Envío no encontrado' })
      return
    }
    res.json({ success: true, message: 'Envío actualizado' })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'putProgramado')
  }
}

/** DELETE /api/ventas/reportes/programados/:id */
export const deleteProgramado = async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM ventas_reportes_programados WHERE id = ?', [Number(req.params.id)])
    res.json({ success: true, message: 'Envío eliminado' })
  } catch (err: unknown) {
    responderErrorVentas(res, err, 'deleteProgramado')
  }
}

/** POST /api/ventas/reportes/programados/:id/enviar — "Enviar ahora" (prueba). */
export const postEnviarProgramado = async (req: Request, res: Response) => {
  try {
    const [fila] = (await query('SELECT * FROM ventas_reportes_programados WHERE id = ?', [
      Number(req.params.id),
    ])) as Array<Record<string, unknown>>
    if (!fila) {
      res.status(404).json({ success: false, message: 'Envío no encontrado' })
      return
    }
    const programado = mapearProgramado(fila)
    await enviarProgramado(programado, { forzar: true })
    res.json({ success: true, message: `Enviado a ${programado.destinatarios.length} destinatario(s)` })
  } catch (err: unknown) {
    if (err instanceof FiltroInvalidoError) {
      responderErrorVentas(res, err, 'postEnviarProgramado')
      return
    }
    res
      .status(502)
      .json({
        success: false,
        message: err instanceof Error ? `No se pudo enviar: ${err.message}` : 'No se pudo enviar',
      })
  }
}
