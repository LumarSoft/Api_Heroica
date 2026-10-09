import ExcelJS from 'exceljs'
import type { ResultSetHeader } from 'mysql2/promise'
import { query } from '../../config/database'
import { construirWhereVentas, type FiltrosVentas } from '../../utils/ventasFiltros'
import { sendReporteVentasEmail } from '../emailService'
import { agregarHojaReporte, ejecutarReporte, validarConfigReporte, METRICAS } from './reportes'

/**
 * Envío de resúmenes de ventas por mail (diario, semanal o mensual), con un reporte del
 * constructor opcional adjunto en Excel. Se dispara desde el cron de ventas, desde
 * node-cron fuera de Vercel y cuando alguien abre el módulo (por si el cron no corrió).
 *
 * Cada envío queda asociado al período que cubre (`ultimo_periodo`): así nunca se manda
 * dos veces el mismo resumen, aunque lo disparen dos invocaciones a la vez.
 */

export type Frecuencia = 'diaria' | 'semanal' | 'mensual'

export interface ReporteProgramado {
  id: number
  nombre: string
  frecuencia: Frecuencia
  diaSemana: number | null
  hora: number
  destinatarios: string[]
  sucursalIds: number[] | null
  reporteGuardadoId: number | null
  activo: boolean
  ultimoEnvioAt: string | null
  ultimoPeriodo: string | null
  ultimoError: string | null
}

const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const NOMBRES_MES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const FILAS_REPORTE_EN_MAIL = 25

const num = (v: unknown): number => Number(v ?? 0) || 0

export function ahoraArgentina(): { fecha: string; hora: number; diaSemana: number } {
  const d = new Date(Date.now() - 3 * 3_600_000)
  // diaSemana ISO: 1 = lunes … 7 = domingo
  return { fecha: d.toISOString().slice(0, 10), hora: d.getUTCHours(), diaSemana: ((d.getUTCDay() + 6) % 7) + 1 }
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function formatFecha(fecha: string): string {
  const [a, m, d] = fecha.split('-')
  return `${d}/${m}/${a}`
}

export interface PeriodoEnvio {
  desde: string
  hasta: string
  clave: string
  etiqueta: string
  comparado: { desde: string; hasta: string; etiqueta: string }
}

/** Qué período cubre el envío de hoy según la frecuencia. */
export function periodoDeEnvio(frecuencia: Frecuencia, hoy: string): PeriodoEnvio {
  if (frecuencia === 'diaria') {
    const ayer = sumarDias(hoy, -1)
    const dia = NOMBRES_DIA[new Date(`${ayer}T12:00:00Z`).getUTCDay()]
    return {
      desde: ayer,
      hasta: ayer,
      clave: `D-${ayer}`,
      etiqueta: `${dia} ${formatFecha(ayer)}`,
      comparado: { desde: sumarDias(ayer, -7), hasta: sumarDias(ayer, -7), etiqueta: `el ${dia} anterior` },
    }
  }
  if (frecuencia === 'semanal') {
    const d = new Date(`${hoy}T12:00:00Z`)
    const lunesActual = sumarDias(hoy, -((d.getUTCDay() + 6) % 7))
    const desde = sumarDias(lunesActual, -7)
    const hasta = sumarDias(lunesActual, -1)
    return {
      desde,
      hasta,
      clave: `S-${desde}`,
      etiqueta: `semana del ${formatFecha(desde)} al ${formatFecha(hasta)}`,
      comparado: { desde: sumarDias(desde, -7), hasta: sumarDias(hasta, -7), etiqueta: 'la semana anterior' },
    }
  }
  const inicioMes = `${hoy.slice(0, 8)}01`
  const hasta = sumarDias(inicioMes, -1)
  const desde = `${hasta.slice(0, 8)}01`
  const finAnterior = sumarDias(desde, -1)
  return {
    desde,
    hasta,
    clave: `M-${desde.slice(0, 7)}`,
    etiqueta: `${NOMBRES_MES[Number(desde.slice(5, 7)) - 1]} ${desde.slice(0, 4)}`,
    comparado: { desde: `${finAnterior.slice(0, 8)}01`, hasta: finAnterior, etiqueta: 'el mes anterior' },
  }
}

export function corresponde(p: ReporteProgramado, ahora = ahoraArgentina()): boolean {
  if (!p.activo || ahora.hora < p.hora) return false
  const periodo = periodoDeEnvio(p.frecuencia, ahora.fecha)
  if (p.ultimoPeriodo === periodo.clave) return false
  if (p.frecuencia === 'semanal' && ahora.diaSemana < (p.diaSemana ?? 1)) return false
  return true
}

export function parsearDestinatarios(valor: unknown): string[] {
  const lista = Array.isArray(valor) ? valor.map(String) : String(valor ?? '').split(/[,;\s]+/)
  return [...new Set(lista.map(e => e.trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))]
}

export function mapearProgramado(f: Record<string, unknown>): ReporteProgramado {
  let sucursalIds: number[] | null = null
  try {
    const crudo = typeof f.sucursal_ids === 'string' ? JSON.parse(f.sucursal_ids) : f.sucursal_ids
    if (Array.isArray(crudo) && crudo.length > 0)
      sucursalIds = crudo.map(Number).filter(n => Number.isInteger(n) && n > 0)
  } catch {
    sucursalIds = null
  }
  return {
    id: Number(f.id),
    nombre: String(f.nombre),
    frecuencia: f.frecuencia as Frecuencia,
    diaSemana: f.dia_semana === null || f.dia_semana === undefined ? null : Number(f.dia_semana),
    hora: Number(f.hora ?? 8),
    destinatarios: parsearDestinatarios(f.destinatarios),
    sucursalIds,
    reporteGuardadoId:
      f.reporte_guardado_id === null || f.reporte_guardado_id === undefined ? null : Number(f.reporte_guardado_id),
    activo: Boolean(f.activo),
    ultimoEnvioAt: f.ultimo_envio_at ? new Date(String(f.ultimo_envio_at)).toISOString() : null,
    ultimoPeriodo: (f.ultimo_periodo as string | null) ?? null,
    ultimoError: (f.ultimo_error as string | null) ?? null,
  }
}

// ─── Contenido del mail ───────────────────────────────────────────────────────

const escapar = (valor: string) =>
  valor.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!)

const moneda = (v: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(v)
const entero = (v: number) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(v)

function variacionHtml(actual: number, anterior: number): string {
  if (!anterior) return '<span style="color:#9ca3af;">—</span>'
  const v = ((actual - anterior) / Math.abs(anterior)) * 100
  const color = v >= 0 ? '#047857' : '#be123c'
  return `<span style="color:${color};font-weight:600;">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1).replace('.', ',')}%</span>`
}

function filtrosSistema(desde: string, hasta: string, sucursalIds: number[] | null): FiltrosVentas {
  return {
    desde,
    hasta,
    sucursalIds: sucursalIds ?? [],
    categoria: null,
    medioPago: null,
    canal: null,
    producto: null,
    vendedor: null,
    caja: null,
    alcance: null,
  }
}

async function kpis(filtros: FiltrosVentas) {
  const venta = construirWhereVentas(filtros, 'venta')
  const pago = construirWhereVentas(filtros, 'pago')
  const [[a], [b]] = (await Promise.all([
    query(
      `SELECT COALESCE(SUM(l.importe),0) AS facturacion, COALESCE(SUM(l.cantidad),0) AS unidades FROM ventas_lineas l WHERE ${venta.where}`,
      venta.params,
    ),
    query(
      `SELECT COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets FROM ventas_lineas l WHERE ${pago.where}`,
      pago.params,
    ),
  ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>]
  const facturacion = num(a?.facturacion)
  const tickets = num(b?.tickets)
  return { facturacion, unidades: num(a?.unidades), tickets, ticketPromedio: tickets ? facturacion / tickets : 0 }
}

async function porSucursal(filtros: FiltrosVentas) {
  const venta = construirWhereVentas(filtros, 'venta')
  return (await query(
    `SELECT COALESCE(s.nombre, 'Sin sucursal asignada') AS sucursal, SUM(l.importe) AS facturacion,
            COUNT(DISTINCT l.fuente, l.fecha, l.transaccion_id) AS tickets
     FROM ventas_lineas l LEFT JOIN sucursales s ON s.id = l.sucursal_id
     WHERE ${venta.where} GROUP BY sucursal ORDER BY facturacion DESC`,
    venta.params,
  )) as Array<Record<string, unknown>>
}

async function topProductos(filtros: FiltrosVentas) {
  const prod = construirWhereVentas(filtros, 'producto')
  return (await query(
    `SELECT COALESCE(l.producto_nombre, 'Sin nombre') AS producto, SUM(l.cantidad) AS unidades, SUM(l.importe) AS facturacion
     FROM ventas_lineas l WHERE ${prod.where} GROUP BY producto ORDER BY facturacion DESC LIMIT 10`,
    prod.params,
  )) as Array<Record<string, unknown>>
}

async function mediosDePago(filtros: FiltrosVentas) {
  const pago = construirWhereVentas(filtros, 'pago')
  return (await query(
    `SELECT COALESCE(l.medio_pago, 'Sin informar') AS medio, SUM(l.importe) AS importe
     FROM ventas_lineas l WHERE ${pago.where} GROUP BY medio ORDER BY importe DESC`,
    pago.params,
  )) as Array<Record<string, unknown>>
}

async function diasFaltantes(desde: string, hasta: string): Promise<number> {
  const [fila] = (await query(
    'SELECT COUNT(DISTINCT fecha) AS dias FROM ventas_dias_sincronizados WHERE fecha BETWEEN ? AND ?',
    [desde, hasta],
  )) as Array<{ dias: number }>
  const total = Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000) + 1
  return Math.max(total - num(fila?.dias), 0)
}

const TH = 'style="padding:8px 10px;background:#002868;color:#fff;font-size:12px;text-align:left;"'
const THR = 'style="padding:8px 10px;background:#002868;color:#fff;font-size:12px;text-align:right;"'
const TD = 'style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;"'
const TDR =
  'style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;text-align:right;white-space:nowrap;"'

function tarjeta(titulo: string, valor: string, variacion: string): string {
  return `<td width="25%" valign="top" style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;">
    <p style="margin:0;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">${titulo}</p>
    <p style="margin:6px 0 4px;color:#002868;font-size:20px;font-weight:700;">${valor}</p>
    <p style="margin:0;font-size:12px;">${variacion}</p></td>`
}

export async function armarMail(p: ReporteProgramado, periodo: PeriodoEnvio) {
  const actual = filtrosSistema(periodo.desde, periodo.hasta, p.sucursalIds)
  const anterior = filtrosSistema(periodo.comparado.desde, periodo.comparado.hasta, p.sucursalIds)
  const [k, kAnt, sucursales, sucursalesAnt, productos, medios, faltan, nombresSucursales] = await Promise.all([
    kpis(actual),
    kpis(anterior),
    porSucursal(actual),
    porSucursal(anterior),
    topProductos(actual),
    mediosDePago(actual),
    diasFaltantes(periodo.desde, periodo.hasta),
    p.sucursalIds?.length
      ? (query(
          `SELECT nombre FROM sucursales WHERE id IN (${p.sucursalIds.map(() => '?').join(',')})`,
          p.sucursalIds,
        ) as Promise<Array<{ nombre: string }>>)
      : Promise.resolve([]),
  ])

  const alcance = nombresSucursales.length ? nombresSucursales.map(s => s.nombre).join(', ') : 'Todas las sucursales'
  const antPorSucursal = new Map(sucursalesAnt.map(s => [String(s.sucursal), num(s.facturacion)]))
  const totalMedios = medios.reduce((a, m) => a + num(m.importe), 0)

  let html = `<h2 style="margin:0 0 4px;color:#111827;font-size:20px;">${escapar(p.nombre)}</h2>
    <p style="margin:0 0 18px;color:#6b7280;font-size:14px;">Ventas de ${escapar(periodo.etiqueta)} · ${escapar(alcance)} · comparado con ${escapar(periodo.comparado.etiqueta)}</p>`
  if (faltan > 0) {
    html += `<p style="margin:0 0 16px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font-size:13px;">
      Atención: ${faltan} ${faltan === 1 ? 'día del período todavía no está importado' : 'días del período todavía no están importados'}. Los números pueden estar incompletos.</p>`
  }
  html += `<table width="100%" cellpadding="0" cellspacing="6"><tr>
    ${tarjeta('Facturación', moneda(k.facturacion), variacionHtml(k.facturacion, kAnt.facturacion))}
    ${tarjeta('Tickets', entero(k.tickets), variacionHtml(k.tickets, kAnt.tickets))}
    ${tarjeta('Ticket promedio', moneda(k.ticketPromedio), variacionHtml(k.ticketPromedio, kAnt.ticketPromedio))}
    ${tarjeta('Unidades', entero(k.unidades), variacionHtml(k.unidades, kAnt.unidades))}
  </tr></table>`

  if (sucursales.length > 0) {
    html += `<h3 style="margin:24px 0 8px;color:#002868;font-size:15px;">Por sucursal</h3>
      <table width="100%" cellpadding="0" cellspacing="0"><tr><th ${TH}>Sucursal</th><th ${THR}>Facturación</th><th ${THR}>Tickets</th><th ${THR}>Ticket prom.</th><th ${THR}>Var.</th></tr>
      ${sucursales.map(s => `<tr><td ${TD}>${escapar(String(s.sucursal))}</td><td ${TDR}>${moneda(num(s.facturacion))}</td><td ${TDR}>${entero(num(s.tickets))}</td><td ${TDR}>${moneda(num(s.tickets) ? num(s.facturacion) / num(s.tickets) : 0)}</td><td ${TDR}>${variacionHtml(num(s.facturacion), antPorSucursal.get(String(s.sucursal)) ?? 0)}</td></tr>`).join('')}
      </table>`
  }
  if (productos.length > 0) {
    html += `<h3 style="margin:24px 0 8px;color:#002868;font-size:15px;">Productos más vendidos</h3>
      <table width="100%" cellpadding="0" cellspacing="0"><tr><th ${TH}>#</th><th ${TH}>Producto</th><th ${THR}>Unidades</th><th ${THR}>Facturación</th></tr>
      ${productos.map((pr, i) => `<tr><td ${TD}>${i + 1}</td><td ${TD}>${escapar(String(pr.producto))}</td><td ${TDR}>${entero(num(pr.unidades))}</td><td ${TDR}>${moneda(num(pr.facturacion))}</td></tr>`).join('')}
      </table>`
  }
  if (medios.length > 0) {
    html += `<h3 style="margin:24px 0 8px;color:#002868;font-size:15px;">Medios de pago</h3>
      <table width="100%" cellpadding="0" cellspacing="0"><tr><th ${TH}>Medio</th><th ${THR}>Importe</th><th ${THR}>%</th></tr>
      ${medios.map(m => `<tr><td ${TD}>${escapar(String(m.medio))}</td><td ${TDR}>${moneda(num(m.importe))}</td><td ${TDR}>${totalMedios ? ((num(m.importe) / totalMedios) * 100).toFixed(1).replace('.', ',') : '0'}%</td></tr>`).join('')}
      </table>`
  }

  const adjuntos: Array<{ nombre: string; contenido: Buffer }> = []
  if (p.reporteGuardadoId) {
    const [guardado] = (await query('SELECT nombre, config FROM ventas_reportes_guardados WHERE id = ?', [
      p.reporteGuardadoId,
    ])) as Array<{ nombre: string; config: unknown }>
    if (guardado) {
      const config = validarConfigReporte(
        typeof guardado.config === 'string' ? JSON.parse(guardado.config) : guardado.config,
      )
      const filtros: FiltrosVentas = {
        ...filtrosSistema(
          periodo.desde,
          periodo.hasta,
          config.filtros.sucursal_ids?.length ? config.filtros.sucursal_ids : p.sucursalIds,
        ),
        categoria: config.filtros.categoria ?? null,
        medioPago: config.filtros.medio_pago ?? null,
        canal: config.filtros.canal ?? null,
        producto: config.filtros.producto ?? null,
        vendedor: config.filtros.vendedor ?? null,
        caja: config.filtros.caja ?? null,
      }
      const resultado = await ejecutarReporte(filtros, config)
      const metricas = resultado.columnas.filter(c => c.tipo !== 'dimension')
      const dims = resultado.columnas.filter(c => c.tipo === 'dimension')
      const formato = (clave: string, v: number | null) => {
        if (v === null) return '—'
        const tipo = METRICAS[clave as keyof typeof METRICAS]?.formato
        return tipo === 'moneda' ? moneda(v) : tipo === 'porcentaje' ? `${v.toFixed(1).replace('.', ',')}%` : entero(v)
      }
      html += `<h3 style="margin:24px 0 8px;color:#002868;font-size:15px;">${escapar(guardado.nombre)}</h3>
        <table width="100%" cellpadding="0" cellspacing="0"><tr>${dims.map(d => `<th ${TH}>${escapar(d.etiqueta)}</th>`).join('')}${metricas.map(m => `<th ${THR}>${escapar(m.etiqueta)}</th>`).join('')}</tr>
        ${resultado.filas
          .slice(0, FILAS_REPORTE_EN_MAIL)
          .map(
            f =>
              `<tr>${dims.map(d => `<td ${TD}>${escapar(f.dimensiones[d.clave] ?? '')}</td>`).join('')}${metricas.map(m => `<td ${TDR}>${formato(m.clave, f.valores[m.clave] ?? null)}</td>`).join('')}</tr>`,
          )
          .join('')}
        </table>${resultado.filas.length > FILAS_REPORTE_EN_MAIL ? `<p style="margin:6px 0 0;color:#6b7280;font-size:12px;">Se muestran ${FILAS_REPORTE_EN_MAIL} de ${resultado.filas.length} filas: el detalle completo va en el Excel adjunto.</p>` : ''}`
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'Heroica'
      agregarHojaReporte(workbook, guardado.nombre, resultado, [
        `Período: ${formatFecha(periodo.desde)} al ${formatFecha(periodo.hasta)}`,
        `Alcance: ${alcance}`,
      ])
      adjuntos.push({
        nombre: `${guardado.nombre.replace(/[^\w\- ]+/g, '').trim() || 'Reporte'}_${periodo.desde}.xlsx`,
        contenido: Buffer.from(await workbook.xlsx.writeBuffer()),
      })
    }
  }

  return {
    asunto: `${p.nombre} — ${periodo.etiqueta}: ${moneda(k.facturacion)}`,
    titulo: p.nombre,
    contenido: html,
    adjuntos,
  }
}

/** Envía un programado. `forzar` = "Enviar ahora" (no marca el período como enviado). */
export async function enviarProgramado(p: ReporteProgramado, opciones: { forzar: boolean }): Promise<void> {
  if (p.destinatarios.length === 0) throw new Error('El envío no tiene destinatarios válidos')
  const ahora = ahoraArgentina()
  const periodo = periodoDeEnvio(p.frecuencia, ahora.fecha)

  if (!opciones.forzar) {
    // Reserva atómica del período: si otra invocación ya lo tomó, no se manda dos veces.
    const reserva = (await query(
      `UPDATE ventas_reportes_programados SET ultimo_periodo = ? WHERE id = ? AND activo = 1 AND (ultimo_periodo IS NULL OR ultimo_periodo <> ?)`,
      [periodo.clave, p.id, periodo.clave],
    )) as ResultSetHeader
    if (reserva.affectedRows === 0) return
  }

  try {
    const mail = await armarMail(p, periodo)
    await sendReporteVentasEmail({ destinatarios: p.destinatarios, ...mail })
    await query('UPDATE ventas_reportes_programados SET ultimo_envio_at = NOW(), ultimo_error = NULL WHERE id = ?', [
      p.id,
    ])
  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : 'Error desconocido'
    await query(
      `UPDATE ventas_reportes_programados SET ultimo_error = ?${opciones.forzar ? '' : ', ultimo_periodo = ?'} WHERE id = ?`,
      opciones.forzar ? [mensaje, p.id] : [mensaje, p.ultimoPeriodo, p.id],
    )
    throw err
  }
}

let ultimaRevision = 0
const REVISION_MIN_MS = 10 * 60_000

/** Manda los envíos que correspondan. Nunca lanza: devuelve el resumen. */
export async function enviarReportesProgramadosPendientes(opciones: { soloSiPasoUnRato?: boolean } = {}) {
  const resumen = { enviados: 0, errores: [] as string[] }
  if (opciones.soloSiPasoUnRato && Date.now() - ultimaRevision < REVISION_MIN_MS) return resumen
  ultimaRevision = Date.now()
  try {
    const filas = (await query('SELECT * FROM ventas_reportes_programados WHERE activo = 1')) as Array<
      Record<string, unknown>
    >
    const ahora = ahoraArgentina()
    for (const p of filas.map(mapearProgramado).filter(x => corresponde(x, ahora))) {
      try {
        await enviarProgramado(p, { forzar: false })
        resumen.enviados++
      } catch (err: unknown) {
        resumen.errores.push(`${p.nombre}: ${err instanceof Error ? err.message : 'error'}`)
        console.error(`[Ventas] Falló el envío programado #${p.id}:`, err instanceof Error ? err.message : err)
      }
    }
  } catch (err: unknown) {
    resumen.errores.push(err instanceof Error ? err.message : 'Error al revisar los envíos programados')
  }
  return resumen
}
