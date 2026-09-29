import { Request, Response } from 'express'
import { query } from '../config/database'
import { bistrosoftConfigurado, obtenerMuestra } from '../services/ventas/bistrosoftClient'
import { normalizarItemsBistrosoft } from '../services/ventas/bistrosoftNormalizer'
import {
  crearSincronizacionManual,
  fechaArgentina,
  MAX_DIAS_SINCRONIZACION,
  procesarPendientes,
  reasignarLineasDeLocal,
  SincronizacionEnCursoError,
  syncAutomaticaHabilitada,
} from '../services/ventas/sincronizacionService'
import type { FuenteVentas } from '../services/ventas/types'
import {
  buscarSucursal,
  obtenerSucursalesActivas,
  vincularLocalesAutomaticamente,
} from '../services/ventas/vinculacionLocales'

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
/** Sin una corrida exitosa en este lapso, la fuente se marca con alerta. */
const HORAS_ALERTA_SIN_SYNC = 3

const FUENTES: Array<{ fuente: FuenteVentas; nombre: string; disponible: boolean }> = [
  { fuente: 'bistrosoft', nombre: 'Bistrosoft', disponible: true },
  { fuente: 'hiopos', nombre: 'Hiopos', disponible: false },
]

function errorInterno(res: Response, contexto: string, err: unknown, mensaje: string) {
  console.error(`[Ventas] Error en ${contexto}:`, err instanceof Error ? err.message : err)
  res.status(500).json({ success: false, message: mensaje })
}

/** GET /api/ventas/integraciones/estado */
export const getEstadoIntegraciones = async (_req: Request, res: Response) => {
  try {
    const [ultimas, sinAsignar, pendientes] = await Promise.all([
      query(
        `SELECT s.fuente,
                MAX(CASE WHEN s.estado IN ('exitosa', 'con_observaciones') THEN s.finalizada_at END) AS ultima_exitosa,
                (SELECT s2.estado FROM ventas_sincronizaciones s2 WHERE s2.fuente = s.fuente
                 ORDER BY s2.id DESC LIMIT 1) AS ultimo_estado,
                (SELECT s2.mensaje FROM ventas_sincronizaciones s2 WHERE s2.fuente = s.fuente
                 ORDER BY s2.id DESC LIMIT 1) AS ultimo_mensaje
         FROM ventas_sincronizaciones s GROUP BY s.fuente`,
      ),
      query(
        `SELECT fuente, COUNT(*) AS cantidad FROM ventas_locales_externos WHERE sucursal_id IS NULL GROUP BY fuente`,
      ),
      query(`SELECT DISTINCT fuente FROM ventas_sincronizaciones WHERE estado = 'en_curso'`),
    ])

    const porFuente = new Map((ultimas as Array<Record<string, unknown>>).map(f => [String(f.fuente), f] as const))
    const sinAsignarPorFuente = new Map(
      (sinAsignar as Array<{ fuente: string; cantidad: number }>).map(f => [f.fuente, Number(f.cantidad)]),
    )
    const conPendientes = new Set((pendientes as Array<{ fuente: string }>).map(f => f.fuente))
    const syncAutomatica = syncAutomaticaHabilitada()

    const data = FUENTES.map(({ fuente, nombre, disponible }) => {
      const fila = porFuente.get(fuente)
      const configurada = fuente === 'bistrosoft' ? bistrosoftConfigurado() : false
      const ultimaExitosa = fila?.ultima_exitosa ? new Date(String(fila.ultima_exitosa)).toISOString() : null
      const ultimoEstado = fila?.ultimo_estado ? String(fila.ultimo_estado) : null
      const desactualizada =
        syncAutomatica &&
        configurada &&
        (!ultimaExitosa || Date.now() - Date.parse(ultimaExitosa) > HORAS_ALERTA_SIN_SYNC * 3_600_000)

      let alerta: string | null = null
      if (disponible && !configurada) alerta = 'Faltan las credenciales de la integración en el servidor'
      else if (ultimoEstado === 'fallida') alerta = `La última sincronización falló: ${fila?.ultimo_mensaje ?? ''}`
      else if (desactualizada) alerta = `Sin sincronizaciones exitosas en las últimas ${HORAS_ALERTA_SIN_SYNC} horas`

      return {
        fuente,
        nombre,
        disponible,
        configurada,
        syncAutomatica: syncAutomatica && configurada,
        enCurso: conPendientes.has(fuente),
        ultimaExitosa,
        ultimoEstado,
        localesSinAsignar: sinAsignarPorFuente.get(fuente) ?? 0,
        alerta: disponible ? alerta : null,
      }
    })

    res.json({ success: true, data })
  } catch (err: unknown) {
    errorInterno(res, 'getEstadoIntegraciones', err, 'Error al consultar el estado de las integraciones')
  }
}

/** GET /api/ventas/integraciones/sincronizaciones?limite=50 */
export const getSincronizaciones = async (req: Request, res: Response) => {
  try {
    const limite = Math.min(200, Math.max(1, Math.floor(Number(req.query.limite) || 50)))
    const filas = (await query(
      `SELECT s.id, s.fuente, s.origen, s.estado, DATE_FORMAT(s.fecha_desde, '%Y-%m-%d') AS fecha_desde,
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
 * POST /api/ventas/integraciones/sincronizar { fuente, desde, hasta }
 * Encola la corrida y responde 202. En Vercel no hay trabajo en segundo plano: la
 * procesan las llamadas a /procesar (la pantalla de integraciones las hace mientras
 * haya corridas en curso) y el cron.
 */
export const postSincronizar = async (req: Request, res: Response) => {
  const { fuente, desde, hasta } = req.body ?? {}
  if (fuente !== 'bistrosoft' && fuente !== 'hiopos') {
    res.status(400).json({ success: false, message: 'Fuente inválida' })
    return
  }
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
    const sincronizacionId = await crearSincronizacionManual({ fuente, desde, hasta, userId: req.user?.id ?? null })
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
    res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : 'No se pudo iniciar la sincronización',
    })
  }
}

/**
 * POST /api/ventas/integraciones/procesar
 * "Sync bajo demanda": la app lo llama al abrir el panel y mientras haya corridas en
 * curso. Crea la corrida automática si corresponde y avanza lo pendiente dentro del
 * presupuesto de tiempo. Si otra invocación ya está procesando, vuelve enseguida.
 */
export const postProcesarPendientes = async (_req: Request, res: Response) => {
  try {
    const resultado = await procesarPendientes('bistrosoft', { crearAutomatica: true })
    res.json({ success: true, data: resultado })
  } catch (err: unknown) {
    errorInterno(res, 'postProcesarPendientes', err, 'Error al procesar las sincronizaciones')
  }
}

/**
 * GET /api/ventas/cron — invocado por Vercel Cron (ver vercel.json).
 * Vercel envía `Authorization: Bearer <CRON_SECRET>`; sin ese secreto no se ejecuta.
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
    const resultado = await procesarPendientes('bistrosoft', { crearAutomatica: true })
    res.json({ success: true, data: resultado })
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
       ORDER BY le.sucursal_id IS NOT NULL, le.fuente, le.nombre_externo, le.codigo_externo`,
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
        // Para los que no se pudieron vincular solos: la sucursal más parecida, a confirmar.
        sugerencia: f.sucursal_id === null ? sugerirSucursal(f.nombre_externo, sucursales) : null,
        ultimaVentaAt: f.ultima_venta_at,
      })),
    })
  } catch (err: unknown) {
    errorInterno(res, 'getLocalesExternos', err, 'Error al consultar los locales de las integraciones')
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

/**
 * GET /api/ventas/integraciones/bistrosoft/muestra?fecha=YYYY-MM-DD
 * Diagnóstico para validar el mapeo con datos reales: devuelve los campos que
 * trae Bistrosoft y cómo se normalizan los primeros ítems.
 */
export const getMuestraBistrosoft = async (req: Request, res: Response) => {
  const fecha = String(req.query.fecha ?? '')
  if (!FECHA_RE.test(fecha)) {
    res.status(400).json({ success: false, message: 'La fecha es obligatoria (YYYY-MM-DD)' })
    return
  }
  if (!bistrosoftConfigurado()) {
    res.status(400).json({ success: false, message: 'Bistrosoft no está configurado en el servidor' })
    return
  }

  try {
    const pagina = await obtenerMuestra(fecha)
    const campos = [...new Set(pagina.items.flatMap(i => Object.keys(i)))].sort()
    const normalizados = normalizarItemsBistrosoft(pagina.items)
    const ejemplos = normalizados.slice(0, 10).map(resultado => (resultado.ok ? resultado.linea : resultado))
    res.json({
      success: true,
      data: { totalPaginas: pagina.totalPages, totalItems: pagina.totalCount, campos, ejemplos },
    })
  } catch (err: unknown) {
    res.status(502).json({
      success: false,
      message: err instanceof Error ? err.message : 'No se pudo consultar Bistrosoft',
    })
  }
}
