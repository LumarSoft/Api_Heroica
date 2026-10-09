import { Request, Response } from 'express'
import { query } from '../config/database'
import { hioposConfigurado } from '../services/ventas/hioposClient'
import { diagnosticarHiopos } from '../services/ventas/hioposDiagnostico'
import {
  CAMPOS_VENTA,
  guardarConfigHiopos,
  leerConfigHiopos,
  validarMapeo,
  type CampoVenta,
  type MapeoColumnas,
} from '../services/ventas/hioposMapeo'
import { enviarReportesProgramadosPendientes } from '../services/ventas/reportesProgramadosService'
import {
  crearSincronizacionManual,
  fechaArgentina,
  MAX_DIAS_SINCRONIZACION,
  procesarPendientes,
  reasignarLineasDeLocal,
  SincronizacionEnCursoError,
  syncAutomaticaHabilitada,
} from '../services/ventas/sincronizacionService'
import {
  buscarSucursal,
  obtenerSucursalesActivas,
  vincularLocalesAutomaticamente,
} from '../services/ventas/vinculacionLocales'

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const GUID_RE = /^[0-9a-fA-F-]{8,64}$/
/** Sin una corrida exitosa en este lapso, la integración se marca con alerta. */
const HORAS_ALERTA_SIN_SYNC = 3

function errorInterno(res: Response, contexto: string, err: unknown, mensaje: string) {
  console.error(`[Ventas] Error en ${contexto}:`, err instanceof Error ? err.message : err)
  res.status(500).json({ success: false, message: mensaje })
}

/** GET /api/ventas/integraciones/estado */
export const getEstadoIntegraciones = async (_req: Request, res: Response) => {
  try {
    const [[fila], [sinAsignar], pendientes, config] = (await Promise.all([
      query(
        `SELECT MAX(CASE WHEN estado IN ('exitosa', 'con_observaciones') THEN finalizada_at END) AS ultima_exitosa,
                (SELECT s2.estado FROM ventas_sincronizaciones s2 WHERE s2.fuente = 'hiopos' AND s2.estado <> 'en_curso'
                 ORDER BY s2.id DESC LIMIT 1) AS ultimo_estado,
                (SELECT s2.mensaje FROM ventas_sincronizaciones s2 WHERE s2.fuente = 'hiopos' AND s2.estado <> 'en_curso'
                 ORDER BY s2.id DESC LIMIT 1) AS ultimo_mensaje
         FROM ventas_sincronizaciones WHERE fuente = 'hiopos'`,
      ),
      query(`SELECT COUNT(*) AS cantidad FROM ventas_locales_externos WHERE fuente = 'hiopos' AND sucursal_id IS NULL`),
      query(`SELECT 1 FROM ventas_sincronizaciones WHERE fuente = 'hiopos' AND estado = 'en_curso' LIMIT 1`),
      leerConfigHiopos(),
    ])) as [
      Array<Record<string, unknown>>,
      Array<{ cantidad: number }>,
      unknown[],
      Awaited<ReturnType<typeof leerConfigHiopos>>,
    ]

    const credenciales = hioposConfigurado()
    const configurada = credenciales && Boolean(config.exportationId)
    const syncAutomatica = syncAutomaticaHabilitada() && configurada
    const ultimaExitosa = fila?.ultima_exitosa ? new Date(String(fila.ultima_exitosa)).toISOString() : null
    const ultimoEstado = fila?.ultimo_estado ? String(fila.ultimo_estado) : null
    const desactualizada =
      syncAutomatica && (!ultimaExitosa || Date.now() - Date.parse(ultimaExitosa) > HORAS_ALERTA_SIN_SYNC * 3_600_000)

    let alerta: string | null = null
    if (!credenciales) alerta = 'Faltan las credenciales de Hiopos en el servidor (HIOPOS_EMAIL / HIOPOS_PASSWORD)'
    else if (!config.exportationId) alerta = 'Falta indicar el dashboard de exportación de HiOffice'
    else if (validarMapeo(config.mapeo).length > 0 && config.columnasDetectadas.length > 0)
      alerta = 'El mapeo de columnas está incompleto: revisalo en Integraciones'
    else if (ultimoEstado === 'fallida') alerta = `La última sincronización falló: ${fila?.ultimo_mensaje ?? ''}`
    else if (desactualizada) alerta = `Sin sincronizaciones exitosas en las últimas ${HORAS_ALERTA_SIN_SYNC} horas`

    res.json({
      success: true,
      data: [
        {
          fuente: 'hiopos',
          nombre: 'Hiopos',
          disponible: true,
          credenciales,
          configurada,
          syncAutomatica,
          incremental: Boolean(config.attrFechaModificado),
          enCurso: pendientes.length > 0,
          ultimaExitosa,
          ultimoEstado,
          localesSinAsignar: Number(sinAsignar?.cantidad ?? 0),
          alerta,
        },
      ],
    })
  } catch (err: unknown) {
    errorInterno(res, 'getEstadoIntegraciones', err, 'Error al consultar el estado de la integración')
  }
}

/** GET /api/ventas/integraciones/sincronizaciones?limite=50 */
export const getSincronizaciones = async (req: Request, res: Response) => {
  try {
    const limite = Math.min(200, Math.max(1, Math.floor(Number(req.query.limite) || 50)))
    const filas = (await query(
      `SELECT s.id, s.fuente, s.origen, s.tipo, s.estado, DATE_FORMAT(s.fecha_desde, '%Y-%m-%d') AS fecha_desde,
              DATE_FORMAT(s.fecha_hasta, '%Y-%m-%d') AS fecha_hasta, s.paginas, s.registros_recibidos,
              s.registros_importados, s.registros_observados, s.registros_rechazados, s.registros_reemplazados,
              s.mensaje, s.iniciada_at, s.finalizada_at, u.nombre AS usuario,
              DATE_FORMAT(s.proximo_dia, '%Y-%m-%d') AS proximo_dia, s.dias_nuevos, s.dias_actualizados,
              DATEDIFF(s.fecha_hasta, s.fecha_desde) + 1 AS dias_totales,
              CASE WHEN s.estado IN ('exitosa', 'con_observaciones') THEN DATEDIFF(s.fecha_hasta, s.fecha_desde) + 1
                   WHEN s.proximo_dia IS NOT NULL THEN DATEDIFF(s.proximo_dia, s.fecha_desde)
                   ELSE NULL END AS dias_procesados
       FROM ventas_sincronizaciones s LEFT JOIN usuarios u ON u.id = s.user_id
       ORDER BY s.id DESC LIMIT ${limite}`,
    )) as Array<Record<string, unknown>>

    res.json({
      success: true,
      data: filas.map(f => ({
        id: Number(f.id),
        fuente: f.fuente,
        origen: f.origen,
        tipo: f.tipo ?? 'rango',
        estado: f.estado,
        fechaDesde: f.fecha_desde,
        fechaHasta: f.fecha_hasta,
        paginas: Number(f.paginas),
        recibidos: Number(f.registros_recibidos),
        importados: Number(f.registros_importados),
        observados: Number(f.registros_observados),
        rechazados: Number(f.registros_rechazados),
        reemplazados: Number(f.registros_reemplazados),
        mensaje: f.mensaje,
        iniciadaAt: f.iniciada_at,
        finalizadaAt: f.finalizada_at,
        usuario: f.usuario ?? null,
        proximoDia: f.proximo_dia ?? null,
        diasNuevos: Number(f.dias_nuevos),
        diasActualizados: Number(f.dias_actualizados),
        diasTotales: Number(f.dias_totales),
        diasProcesados: f.dias_procesados === null ? null : Number(f.dias_procesados),
      })),
    })
  } catch (err: unknown) {
    errorInterno(res, 'getSincronizaciones', err, 'Error al consultar el historial de sincronizaciones')
  }
}

/**
 * POST /api/ventas/integraciones/sincronizar { desde, hasta }
 * Encola la corrida y responde 202. La procesan las llamadas a /procesar (la pantalla
 * de integraciones las hace mientras haya corridas en curso) y el cron.
 */
export const postSincronizar = async (req: Request, res: Response) => {
  const { desde, hasta } = req.body ?? {}
  if (typeof desde !== 'string' || typeof hasta !== 'string' || !FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) {
    res.status(400).json({ success: false, message: 'Las fechas desde y hasta son obligatorias (YYYY-MM-DD)' })
    return
  }
  if (desde > hasta) {
    res.status(400).json({ success: false, message: 'La fecha desde no puede ser posterior a hasta' })
    return
  }
  if (hasta > fechaArgentina(0)) {
    res.status(400).json({ success: false, message: 'No se pueden sincronizar fechas futuras' })
    return
  }

  try {
    const sincronizacionId = await crearSincronizacionManual({ desde, hasta, userId: req.user?.id ?? null })
    res.status(202).json({
      success: true,
      message: 'Sincronización en cola',
      data: { sincronizacionId, maxDias: MAX_DIAS_SINCRONIZACION },
    })
  } catch (err: unknown) {
    if (err instanceof SincronizacionEnCursoError) {
      res.status(409).json({ success: false, message: err.message })
      return
    }
    res
      .status(400)
      .json({ success: false, message: err instanceof Error ? err.message : 'No se pudo iniciar la sincronización' })
  }
}

/**
 * POST /api/ventas/integraciones/procesar
 * "Sync bajo demanda": la app lo llama al abrir el panel y mientras haya corridas en curso.
 */
export const postProcesarPendientes = async (_req: Request, res: Response) => {
  try {
    const resultado = await procesarPendientes({ crearAutomatica: true })
    // Por si el cron no corrió: los envíos por mail vencidos salen con el uso normal del módulo.
    if (!resultado.quedanPendientes) await enviarReportesProgramadosPendientes({ soloSiPasoUnRato: true })
    res.json({ success: true, data: resultado })
  } catch (err: unknown) {
    errorInterno(res, 'postProcesarPendientes', err, 'Error al procesar las sincronizaciones')
  }
}

/**
 * GET /api/ventas/cron — invocado por Vercel Cron (ver vercel.json).
 * Vercel envía `Authorization: Bearer <CRON_SECRET>`; sin ese secreto no se ejecuta.
 * Sincroniza y después manda los reportes por mail que estén vencidos.
 */
export const getCronVentas = async (req: Request, res: Response) => {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    res.status(503).json({ success: false, message: 'CRON_SECRET no está configurado' })
    return
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    res.status(401).json({ success: false, message: 'No autorizado' })
    return
  }
  try {
    const resultado = await procesarPendientes({ crearAutomatica: true })
    const reportes = await enviarReportesProgramadosPendientes()
    res.json({ success: true, data: { ...resultado, reportes } })
  } catch (err: unknown) {
    errorInterno(res, 'getCronVentas', err, 'Error en el cron de ventas')
  }
}

function sugerirSucursal(nombreExterno: unknown, sucursales: Array<{ id: number; nombre: string }>) {
  const coincidencia = buscarSucursal(typeof nombreExterno === 'string' ? nombreExterno : null, sucursales)
  return coincidencia ? { id: coincidencia.sucursalId, nombre: coincidencia.nombre } : null
}

/** GET /api/ventas/integraciones/locales */
export const getLocalesExternos = async (_req: Request, res: Response) => {
  try {
    await vincularLocalesAutomaticamente()
    const [filas, sucursales] = (await Promise.all([
      query(
        `SELECT le.id, le.fuente, le.codigo_externo, le.nombre_externo, le.sucursal_id, le.asignacion, s.nombre AS sucursal,
              DATE_FORMAT(le.ultima_venta_at, '%Y-%m-%dT%H:%i:%s') AS ultima_venta_at
       FROM ventas_locales_externos le LEFT JOIN sucursales s ON s.id = le.sucursal_id
       ORDER BY le.sucursal_id IS NOT NULL, le.nombre_externo, le.codigo_externo`,
      ),
      obtenerSucursalesActivas(),
    ])) as [Array<Record<string, unknown>>, Array<{ id: number; nombre: string }>]

    res.json({
      success: true,
      data: filas.map(f => ({
        id: Number(f.id),
        fuente: f.fuente,
        codigoExterno: f.codigo_externo,
        nombreExterno: f.nombre_externo,
        sucursalId: f.sucursal_id === null ? null : Number(f.sucursal_id),
        sucursal: f.sucursal ?? null,
        asignacion: f.asignacion ?? null,
        sugerencia: f.sucursal_id === null ? sugerirSucursal(f.nombre_externo, sucursales) : null,
        ultimaVentaAt: f.ultima_venta_at,
      })),
    })
  } catch (err: unknown) {
    errorInterno(res, 'getLocalesExternos', err, 'Error al consultar los locales de Hiopos')
  }
}

/** PUT /api/ventas/integraciones/locales/:id { sucursal_id: number | null } */
export const putLocalExterno = async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const raw = req.body?.sucursal_id
  const sucursalId = raw === null || raw === '' || raw === undefined ? null : Number(raw)
  if (!Number.isInteger(id) || id <= 0 || (sucursalId !== null && (!Number.isInteger(sucursalId) || sucursalId <= 0))) {
    res.status(400).json({ success: false, message: 'Datos inválidos' })
    return
  }

  try {
    if (sucursalId !== null) {
      const existe = (await query('SELECT id FROM sucursales WHERE id = ? AND deleted_at IS NULL', [
        sucursalId,
      ])) as unknown[]
      if (existe.length === 0) {
        res.status(404).json({ success: false, message: 'Sucursal no encontrada' })
        return
      }
    }
    const resultado = (await query(
      "UPDATE ventas_locales_externos SET sucursal_id = ?, asignacion = 'manual' WHERE id = ?",
      [sucursalId, id],
    )) as { affectedRows: number }
    if (resultado.affectedRows === 0) {
      res.status(404).json({ success: false, message: 'Local no encontrado' })
      return
    }
    const lineasActualizadas = await reasignarLineasDeLocal(id, sucursalId)
    res.json({ success: true, message: 'Local actualizado', data: { lineasActualizadas } })
  } catch (err: unknown) {
    errorInterno(res, 'putLocalExterno', err, 'Error al actualizar el local')
  }
}

// ─── Configuración de Hiopos ──────────────────────────────────────────────────

/** GET /api/ventas/integraciones/hiopos/config */
export const getConfigHiopos = async (_req: Request, res: Response) => {
  try {
    const config = await leerConfigHiopos()
    res.json({
      success: true,
      data: {
        credenciales: hioposConfigurado(),
        exportationId: config.exportationId,
        exportationIdOrigen: config.exportationIdOrigen,
        attrFechaModificado: config.attrFechaModificado,
        mapeo: config.mapeo,
        faltantesMapeo: validarMapeo(config.mapeo),
        columnasDetectadas: config.columnasDetectadas,
        filtrosDashboard: config.filtrosDashboard,
        diasPorTramo: config.diasPorTramo,
        watermark: config.watermarkMs ? new Date(config.watermarkMs).toISOString() : null,
        verificadoAt: config.verificadoAt,
        ultimoError: config.ultimoError,
        campos: CAMPOS_VENTA.map(({ campo, etiqueta, ayuda, requerido }) => ({ campo, etiqueta, ayuda, requerido })),
      },
    })
  } catch (err: unknown) {
    errorInterno(res, 'getConfigHiopos', err, 'Error al leer la configuración de Hiopos')
  }
}

/**
 * PUT /api/ventas/integraciones/hiopos/config
 * { exportationId?, attrFechaModificado?, mapeo?, diasPorTramo?, reiniciarMarca? }
 */
export const putConfigHiopos = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const cambios: Parameters<typeof guardarConfigHiopos>[0] = { updated_by: req.user?.id ?? null }

  if (body.exportationId !== undefined) {
    const valor = typeof body.exportationId === 'string' ? body.exportationId.trim() : ''
    if (valor && !GUID_RE.test(valor)) {
      res
        .status(400)
        .json({ success: false, message: 'El exportationId debe ser el GUID del dashboard (ej. xxxxxxxx-xxxx-…)' })
      return
    }
    cambios.exportation_id = valor || null
  }
  if (body.attrFechaModificado !== undefined) {
    const n =
      body.attrFechaModificado === null || body.attrFechaModificado === '' ? null : Number(body.attrFechaModificado)
    if (n !== null && (!Number.isInteger(n) || n <= 0)) {
      res.status(400).json({ success: false, message: 'El filtro de Fecha Modificado es inválido' })
      return
    }
    cambios.attr_fecha_modificado = n
  }
  if (body.diasPorTramo !== undefined) {
    const n = Number(body.diasPorTramo)
    if (!Number.isInteger(n) || n < 1 || n > 31) {
      res.status(400).json({ success: false, message: 'Los días por consulta deben estar entre 1 y 31' })
      return
    }
    cambios.dias_por_tramo = n
  }
  if (body.mapeo !== undefined) {
    if (!body.mapeo || typeof body.mapeo !== 'object' || Array.isArray(body.mapeo)) {
      res.status(400).json({ success: false, message: 'Mapeo inválido' })
      return
    }
    const validos = new Set<string>(CAMPOS_VENTA.map(c => c.campo))
    const mapeo: MapeoColumnas = {}
    for (const [campo, columna] of Object.entries(body.mapeo as Record<string, unknown>)) {
      if (validos.has(campo) && typeof columna === 'string' && columna.trim())
        mapeo[campo as CampoVenta] = columna.trim().slice(0, 200)
    }
    const faltantes = validarMapeo(mapeo)
    if (faltantes.length > 0) {
      res.status(400).json({ success: false, message: faltantes.join('. ') })
      return
    }
    cambios.mapeo_columnas = mapeo
  }
  if (body.reiniciarMarca === true) cambios.watermark_ms = null

  try {
    await guardarConfigHiopos(cambios)
    res.json({ success: true, message: 'Configuración guardada' })
  } catch (err: unknown) {
    errorInterno(res, 'putConfigHiopos', err, 'Error al guardar la configuración de Hiopos')
  }
}

/**
 * POST /api/ventas/integraciones/hiopos/diagnostico { fecha }
 * Prueba de punta a punta contra el Bridge (no importa ventas). Guarda lo descubierto:
 * filtros del dashboard, columnas y, si todavía no había, el mapeo y el filtro de Fecha Modificado.
 */
export const postDiagnosticoHiopos = async (req: Request, res: Response) => {
  const fecha = String(req.body?.fecha ?? fechaArgentina(1))
  if (!FECHA_RE.test(fecha)) {
    res.status(400).json({ success: false, message: 'La fecha es obligatoria (YYYY-MM-DD)' })
    return
  }
  try {
    const config = await leerConfigHiopos()
    const resultado = await diagnosticarHiopos(config, fecha)
    const cambios: Parameters<typeof guardarConfigHiopos>[0] = {}
    if (resultado.filtros.length > 0) cambios.filtros_dashboard = resultado.filtros
    if (!config.attrFechaModificado && resultado.attrFechaModificadoSugerido) {
      cambios.attr_fecha_modificado = resultado.attrFechaModificadoSugerido
    }
    if (resultado.columnas.length > 0) cambios.columnas_detectadas = resultado.columnas
    if (validarMapeo(config.mapeo).length > 0 && resultado.faltantesMapeo.length === 0 && resultado.filas > 0) {
      cambios.mapeo_columnas = resultado.mapeoUsado
    }
    cambios.verificado_at = new Date()
    cambios.ultimo_error = resultado.ok ? null : (resultado.pasos.find(p => !p.ok)?.detalle ?? null)
    await guardarConfigHiopos(cambios)
    res.json({ success: true, data: resultado })
  } catch (err: unknown) {
    errorInterno(res, 'postDiagnosticoHiopos', err, 'Error al diagnosticar la integración con Hiopos')
  }
}
