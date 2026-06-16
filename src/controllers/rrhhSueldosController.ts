import { Request, Response } from 'express'
import { query } from '../config/database'
import { sendNotificacionEmail } from '../services/notificacionesEmailService'

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

const AJUSTE_FIELDS = [
  'aplica_valor_hora',
  'aplica_sueldo_basico_escala',
  'aplica_horas_extra',
  'aplica_incentivos',
  'aplica_banco',
  'hs_realizadas_mes',
  'valor_hora',
  'sueldo_basico',
  'horas_extra_50',
  'horas_extra_hs',
  'horas_feriado',
  'horas_feriado_hs',
  'incentivos',
  'incentivos_seleccionados',
  'extras',
  'ausencias_justificadas',
  'ausencias_injustificadas',
  'tardanzas',
  'descuentos',
  'adelantos',
  'sueldo_sac',
  'sueldo_neto',
  'banco',
  'efectivo',
  'fecha_deposito',
  'sueldo_pagado',
  'comentario_cobro',
] as const

const NUMERIC_AJUSTE_FIELDS = AJUSTE_FIELDS.filter(
  field => !['fecha_deposito', 'incentivos_seleccionados', 'comentario_cobro'].includes(field),
)

type AjusteField = (typeof AJUSTE_FIELDS)[number]
type SueldoAjustes = Partial<Record<AjusteField, string | number | null>>

interface IncentivoPeriodo {
  id: number
  nombre: string
  monto: number
}

interface NovedadEmpleado {
  personal_id?: number
  horas_trabajadas?: number | null
  horas_feriados?: number | null
  horas_extras_autorizadas?: boolean
  horas_extras_cantidad?: number | null
  incentivos?: Array<{ incentivo_id: number; aplica: boolean }>
  descuento?: { tiene?: boolean; monto?: number | null }
  ausencias_justificadas?: { tiene?: boolean; cantidad?: number | null; unidad?: 'horas' | 'minutos' }
  ausencias_injustificadas?: { cantidad?: number | null; unidad?: 'horas' | 'minutos' }
  tardanzas?: { tiene?: boolean; cantidad?: number | null; unidad?: 'horas' | 'minutos' }
}

interface SueldoAggregate {
  horasExtraImporte: number
  horasExtraHoras: number
  descuentos: number
  adelantos: number
  incentivos: number
  ausenciasJustificadas: number
  ausenciasJustificadasHoras: number
  ausenciasInjustificadasHoras: number
  tardanzasHoras: number
  horasTrabajadas: number
  horasFeriadoHoras: number
  novedadIncentivoIds: number[] | null
  tieneNovedadSueldo: boolean
  apercibimientos: number
}

function createSueldoAggregate(): SueldoAggregate {
  return {
    horasExtraImporte: 0,
    horasExtraHoras: 0,
    descuentos: 0,
    adelantos: 0,
    incentivos: 0,
    ausenciasJustificadas: 0,
    ausenciasJustificadasHoras: 0,
    ausenciasInjustificadasHoras: 0,
    tardanzasHoras: 0,
    horasTrabajadas: 0,
    horasFeriadoHoras: 0,
    novedadIncentivoIds: null,
    tieneNovedadSueldo: false,
    apercibimientos: 0,
  }
}

function parsePeriodo(req: Request) {
  const hoy = new Date()
  const mes = req.query.mes ? Number(req.query.mes) : hoy.getMonth() + 1
  const anio = req.query.anio ? Number(req.query.anio) : hoy.getFullYear()
  return { mes, anio }
}

function parseDetalles(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return {}
  }
}

function parseSelectedIds(value: unknown): number[] | null {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite)
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : null
  } catch {
    return null
  }
}

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function cantidadToHoras(cantidad: unknown, unidad: unknown): number {
  const value = toNumber(cantidad)
  return unidad === 'minutos' ? value / 60 : value
}

function daysBetweenInclusive(from: unknown, to: unknown): number {
  if (typeof from !== 'string' || typeof to !== 'string') return 0
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
}

// Cálculo de la liquidación final según antigüedad (FA = alta, FB = baja)
interface LiqFinalDefaults {
  antiguedadAnios: number
  antiguedadTexto: string
  sac: number
  vng: number
  preaviso: number
}

function computeLiqFinalDefaults(fa: string, fb: string, sueldoMensual: number): LiqFinalDefaults {
  const empty: LiqFinalDefaults = { antiguedadAnios: 0, antiguedadTexto: '—', sac: 0, vng: 0, preaviso: 0 }
  if (!fa || !fb || sueldoMensual <= 0) return empty
  const alta = new Date(`${fa.slice(0, 10)}T00:00:00`)
  const baja = new Date(`${fb.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(alta.getTime()) || Number.isNaN(baja.getTime()) || baja < alta) return empty

  const msDia = 86_400_000
  const diasTotales = Math.floor((baja.getTime() - alta.getTime()) / msDia) + 1
  const antiguedadAnios = diasTotales / 365
  const aniosEnteros = Math.floor(antiguedadAnios)
  const mesesResto = Math.floor((antiguedadAnios - aniosEnteros) * 12)
  const antiguedadTexto =
    aniosEnteros > 0
      ? `${aniosEnteros} año${aniosEnteros !== 1 ? 's' : ''}${mesesResto > 0 ? ` y ${mesesResto} mes${mesesResto !== 1 ? 'es' : ''}` : ''}`
      : `${Math.max(mesesResto, 0)} mes${mesesResto !== 1 ? 'es' : ''}`

  // SAC proporcional: 50% de la mejor remuneración * (días trabajados del semestre / 182)
  const anioBaja = baja.getFullYear()
  const inicioSemestre = baja.getMonth() < 6 ? new Date(anioBaja, 0, 1) : new Date(anioBaja, 6, 1)
  const inicioComputo = alta > inicioSemestre ? alta : inicioSemestre
  const diasSemestre = Math.floor((baja.getTime() - inicioComputo.getTime()) / msDia) + 1
  const sac = Math.round((sueldoMensual / 2) * Math.min(Math.max(diasSemestre, 0) / 182, 1))

  // Vacaciones no gozadas: días por antigüedad, proporcional al año de la baja
  const diasVacacionesBase = antiguedadAnios >= 20 ? 35 : antiguedadAnios >= 10 ? 28 : antiguedadAnios >= 5 ? 21 : 14
  const inicioAnio = new Date(anioBaja, 0, 1)
  const inicioAnioComputo = alta > inicioAnio ? alta : inicioAnio
  const diasTrabajadosAnio = Math.floor((baja.getTime() - inicioAnioComputo.getTime()) / msDia) + 1
  const diasVacProporcional = (diasVacacionesBase * Math.min(Math.max(diasTrabajadosAnio, 0), 365)) / 365
  const vng = Math.round((sueldoMensual / 25) * diasVacProporcional)

  // Preaviso: < 5 años → 1 mes; ≥ 5 años → 2 meses (período de prueba < 3 meses → 0)
  const preaviso = antiguedadAnios < 0.25 ? 0 : antiguedadAnios >= 5 ? sueldoMensual * 2 : sueldoMensual
  return {
    antiguedadAnios: Math.round(antiguedadAnios * 100) / 100,
    antiguedadTexto,
    sac,
    vng,
    preaviso: Math.round(preaviso),
  }
}

function applyAjustes<T extends Record<string, unknown>>(base: T, ajustes?: SueldoAjustes): T {
  if (!ajustes) return base
  const next: Record<string, unknown> = { ...base }
  for (const field of AJUSTE_FIELDS) {
    const value = ajustes[field]
    if (value !== null && value !== undefined) {
      next[field] = NUMERIC_AJUSTE_FIELDS.includes(field) ? toNumber(value) : value
    }
  }
  return next as T
}

// El SAC (aguinaldo) solo se liquida en junio y diciembre
function esMesSac(mes: number): boolean {
  return mes === 6 || mes === 12
}

function calculateNeto(row: Record<string, unknown>, mes?: number) {
  const sac = mes !== undefined && esMesSac(mes) ? toNumber(row.sueldo_sac) : 0
  return (
    toNumber(row.sueldo_basico) +
    toNumber(row.horas_extra_50) +
    toNumber(row.horas_feriado) +
    toNumber(row.incentivos) +
    toNumber(row.extras) +
    sac +
    toNumber(row.ausencias_justificadas) -
    toNumber(row.ausencias_injustificadas) -
    toNumber(row.tardanzas) -
    toNumber(row.descuentos) -
    toNumber(row.adelantos)
  )
}

function distributeByFormaCobro(row: Record<string, unknown>, formaCobro: string) {
  const neto = toNumber(row.sueldo_neto)
  return {
    banco: formaCobro === 'efectivo' ? 0 : neto,
    efectivo: formaCobro === 'efectivo' ? neto : 0,
  }
}

// GET /api/rrhh/sueldos?sucursal_id=X&mes=M&anio=A
export const getSueldosPeriodo = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.query.sucursal_id)
    if (!sucursalId) {
      return res.status(400).json({ success: false, message: 'sucursal_id es requerido' })
    }

    const { mes, anio } = parsePeriodo(req)
    if (mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({ success: false, message: 'Período inválido' })
    }

    const personalRows = (await query(
      `SELECT
         p.id,
         p.nombre,
         p.legajo,
         COALESCE(p.forma_cobro, 'banco') AS forma_cobro,
         pu.id      AS puesto_id,
         pu.nombre  AS puesto,
         COALESCE(notas.comentarios_count, 0) AS comentarios_count,
         COALESCE(
           (SELECT es.id
            FROM   escalas_salariales es
            WHERE  es.puesto_id   = p.puesto_id
              AND  es.sucursal_id = p.sucursal_id
              AND  es.deleted_at IS NULL
              AND  (es.anio < ? OR (es.anio = ? AND es.mes <= ?))
            ORDER  BY es.anio DESC, es.mes DESC
            LIMIT  1),
           0
         ) AS escala_id,
         COALESCE(
           (SELECT es.sueldo_base
            FROM   escalas_salariales es
            WHERE  es.puesto_id   = p.puesto_id
              AND  es.sucursal_id = p.sucursal_id
              AND  es.deleted_at IS NULL
              AND  (es.anio < ? OR (es.anio = ? AND es.mes <= ?))
            ORDER  BY es.anio DESC, es.mes DESC
            LIMIT  1),
           0
         ) AS sueldo_base,
         COALESCE(
           (SELECT es.valor_hora
            FROM   escalas_salariales es
            WHERE  es.puesto_id   = p.puesto_id
              AND  es.sucursal_id = p.sucursal_id
              AND  es.deleted_at IS NULL
              AND  (es.anio < ? OR (es.anio = ? AND es.mes <= ?))
            ORDER  BY es.anio DESC, es.mes DESC
            LIMIT  1),
           0
         ) AS valor_hora
       FROM  personal p
       JOIN  puestos pu ON pu.id = p.puesto_id AND pu.deleted_at IS NULL
       LEFT JOIN (
         SELECT personal_id, COUNT(*) AS comentarios_count
         FROM personal_notas
         WHERE deleted_at IS NULL
         GROUP BY personal_id
       ) notas ON notas.personal_id = p.id
       WHERE p.sucursal_id = ?
         AND p.activo      = 1
         AND p.deleted_at IS NULL
       ORDER BY p.nombre ASC`,
      [anio, anio, mes, anio, anio, mes, anio, anio, mes, sucursalId],
    )) as any[]

    const conSueldo = personalRows.filter(p => Number(p.sueldo_base) > 0)
    const personalIds = conSueldo.map(p => Number(p.id))

    const solicitudesRows = personalIds.length
      ? ((await query(
          `SELECT personal_id, tipo, detalles
           FROM rrhh_solicitudes
           WHERE deleted_at IS NULL
             AND estado = 'Aprobada'
             AND personal_id IN (${personalIds.map(() => '?').join(',')})
             AND MONTH(fecha_solicitud) = ?
             AND YEAR(fecha_solicitud) = ?`,
          [...personalIds, mes, anio],
        )) as any[])
      : []

    const solicitudesMap = new Map<number, SueldoAggregate>()
    const novedadesMap = new Map<number, SueldoAggregate>()

    for (const solicitud of solicitudesRows) {
      const personalId = Number(solicitud.personal_id)
      if (!solicitudesMap.has(personalId)) {
        solicitudesMap.set(personalId, createSueldoAggregate())
      }
      const aggregate = solicitudesMap.get(personalId)!
      const detalles = parseDetalles(solicitud.detalles)
      const tipo = String(solicitud.tipo)
      if (tipo === 'Horas extras') {
        const horas = toNumber(detalles.cantidad_horas)
        const personal = conSueldo.find(p => Number(p.id) === personalId)
        const valorHora = toNumber(detalles.valor_hora) || toNumber(personal?.valor_hora)
        aggregate.horasExtraHoras += horas
        aggregate.horasExtraImporte += horas * valorHora * 1.5
      }
      if (tipo === 'Descuentos') aggregate.descuentos += toNumber(detalles.monto)
      if (tipo === 'Adelantos') aggregate.adelantos += toNumber(detalles.monto)
      if (tipo === 'Incentivos y premios') aggregate.incentivos += toNumber(detalles.monto)
      if (tipo === 'Apercibimientos') aggregate.apercibimientos += 1
      if (tipo === 'Licencias' || tipo === 'Vacaciones' || tipo === 'Suspensiones') {
        aggregate.ausenciasJustificadas +=
          toNumber(detalles.cantidad_dias) || daysBetweenInclusive(detalles.fecha_desde, detalles.fecha_hasta)
      }
    }

    const novedadesRows = (await query(
      `SELECT detalles
       FROM rrhh_solicitudes
       WHERE deleted_at IS NULL
         AND estado = 'Aprobada'
         AND tipo = 'Novedades de sueldo'
         AND sucursal_id = ?`,
      [sucursalId],
    )) as any[]

    for (const novedad of novedadesRows) {
      const detalles = parseDetalles(novedad.detalles)
      if (Number(detalles.mes) !== mes || Number(detalles.anio) !== anio || !Array.isArray(detalles.empleados)) continue

      for (const empleado of detalles.empleados as NovedadEmpleado[]) {
        const personalId = Number(empleado.personal_id)
        if (!personalIds.includes(personalId)) continue
        if (!novedadesMap.has(personalId)) {
          novedadesMap.set(personalId, createSueldoAggregate())
        }

        const aggregate = novedadesMap.get(personalId)!
        aggregate.tieneNovedadSueldo = true
        aggregate.horasTrabajadas += toNumber(empleado.horas_trabajadas)
        aggregate.horasFeriadoHoras += toNumber(empleado.horas_feriados)
        if (empleado.horas_extras_autorizadas) {
          aggregate.horasExtraHoras += toNumber(empleado.horas_extras_cantidad)
        }
        if (empleado.descuento?.tiene && empleado.descuento.monto != null) {
          aggregate.descuentos += toNumber(empleado.descuento.monto)
        }
        if (empleado.ausencias_justificadas?.tiene) {
          aggregate.ausenciasJustificadasHoras += cantidadToHoras(
            empleado.ausencias_justificadas.cantidad,
            empleado.ausencias_justificadas.unidad,
          )
        }
        aggregate.ausenciasInjustificadasHoras += cantidadToHoras(
          empleado.ausencias_injustificadas?.cantidad,
          empleado.ausencias_injustificadas?.unidad,
        )
        if (empleado.tardanzas?.tiene) {
          aggregate.tardanzasHoras += cantidadToHoras(empleado.tardanzas.cantidad, empleado.tardanzas.unidad)
        }
        if (Array.isArray(empleado.incentivos)) {
          aggregate.novedadIncentivoIds = empleado.incentivos
            .filter(incentivo => incentivo.aplica)
            .map(incentivo => Number(incentivo.incentivo_id))
            .filter(Number.isFinite)
        }
      }
    }

    const incentivosGlobales = (await query(
      `SELECT i.id, i.nombre, i.metodo_calculo, i.valor
       FROM rrhh_incentivos_premios i
       WHERE i.deleted_at IS NULL
         AND i.activo = 1
         AND i.sucursal_id = ?
         AND i.mes = ?
         AND i.anio = ?
       ORDER BY i.nombre ASC`,
      [sucursalId, mes, anio],
    )) as any[]

    const ajustesRows = personalIds.length
      ? ((await query(
          `SELECT *
           FROM rrhh_sueldos_periodo_ajustes
           WHERE personal_id IN (${personalIds.map(() => '?').join(',')})
             AND mes = ?
             AND anio = ?`,
          [...personalIds, mes, anio],
        )) as any[])
      : []
    const ajustesMap = new Map<number, SueldoAjustes>(ajustesRows.map(row => [Number(row.personal_id), row]))

    // Liquidaciones finales del período con datos completos para simulación
    const liquidacionesRows = (await query(
      `SELECT
         lf.id,
         lf.personal_id,
         p.nombre,
         p.legajo,
         DATE_FORMAT(p.fecha_incorporacion, '%Y-%m-%d') AS fa,
         COALESCE(p.forma_cobro, 'banco')               AS forma_cobro,
         pu.id                                           AS puesto_id,
         pu.nombre                                       AS puesto,
         s.fecha_solicitud,
         lf.estado,
         s.detalles,
         COALESCE(
           (SELECT es.sueldo_base FROM escalas_salariales es
            WHERE es.puesto_id = p.puesto_id AND es.sucursal_id = p.sucursal_id AND es.deleted_at IS NULL
              AND (es.anio < ? OR (es.anio = ? AND es.mes <= ?))
            ORDER BY es.anio DESC, es.mes DESC LIMIT 1), 0
         ) AS sueldo_base,
         COALESCE(
           (SELECT es.valor_hora FROM escalas_salariales es
            WHERE es.puesto_id = p.puesto_id AND es.sucursal_id = p.sucursal_id AND es.deleted_at IS NULL
              AND (es.anio < ? OR (es.anio = ? AND es.mes <= ?))
            ORDER BY es.anio DESC, es.mes DESC LIMIT 1), 0
         ) AS valor_hora_escala,
         lfa.aplica_valor_hora          AS aj_aplica_valor_hora,
         lfa.aplica_sueldo_basico_escala AS aj_aplica_sueldo_basico_escala,
         lfa.aplica_banco               AS aj_aplica_banco,
         lfa.aplica_horas_extra         AS aj_aplica_horas_extra,
         lfa.aplica_incentivos          AS aj_aplica_incentivos,
         lfa.valor_hora                 AS aj_valor_hora,
         lfa.sueldo_basico              AS aj_sueldo_basico,
         lfa.horas_extra_50             AS aj_horas_extra_50,
         lfa.horas_extra_hs             AS aj_horas_extra_hs,
         lfa.horas_feriado              AS aj_horas_feriado,
         lfa.horas_feriado_hs           AS aj_horas_feriado_hs,
         lfa.incentivos                 AS aj_incentivos,
         lfa.incentivos_seleccionados   AS aj_incentivos_seleccionados,
         lfa.extras                     AS aj_extras,
         lfa.ausencias_justificadas     AS aj_ausencias_justificadas,
         lfa.ausencias_injustificadas   AS aj_ausencias_injustificadas,
         lfa.tardanzas                  AS aj_tardanzas,
         lfa.descuentos                 AS aj_descuentos,
         lfa.adelantos                  AS aj_adelantos,
         lfa.sueldo_neto                AS aj_sueldo_neto,
         lfa.banco                      AS aj_banco,
         lfa.efectivo                   AS aj_efectivo,
         lfa.sac_porcentaje             AS aj_sac_porcentaje,
         lfa.sac_importe                AS aj_sac_importe,
         lfa.vng_porcentaje             AS aj_vng_porcentaje,
         lfa.vng_importe                AS aj_vng_importe,
         lfa.preaviso_porcentaje        AS aj_preaviso_porcentaje,
         lfa.preaviso_importe           AS aj_preaviso_importe,
         lfa.total_liq                  AS aj_total_liq,
         lfa.liq_banco                  AS aj_liq_banco,
         lfa.liq_efectivo               AS aj_liq_efectivo,
         lfa.total_general              AS aj_total_general,
         lfa.sueldo_pagado              AS aj_sueldo_pagado,
         DATE_FORMAT(lfa.fecha_deposito, '%Y-%m-%d') AS aj_fecha_deposito,
         lfa.comentario_cobro           AS aj_comentario_cobro,
         lfa.ministerio_aplica          AS aj_ministerio_aplica,
         lfa.ministerio_direccion       AS aj_ministerio_direccion,
         DATE_FORMAT(lfa.ministerio_fecha, '%Y-%m-%d') AS aj_ministerio_fecha,
         lfa.ministerio_horario         AS aj_ministerio_horario,
         lfa.enviado_pagos              AS aj_enviado_pagos,
         lfa.fecha_enviado_pagos        AS aj_fecha_enviado_pagos
       FROM  rrhh_liquidaciones_finales lf
       JOIN  rrhh_solicitudes s ON s.id = lf.solicitud_id AND s.deleted_at IS NULL
       JOIN  personal p ON p.id = lf.personal_id AND p.deleted_at IS NULL
       JOIN  puestos pu ON pu.id = p.puesto_id AND pu.deleted_at IS NULL
       LEFT JOIN rrhh_liquidaciones_finales_ajustes lfa ON lfa.liquidacion_id = lf.id
       WHERE p.sucursal_id = ?
         AND MONTH(s.fecha_solicitud) = ?
         AND YEAR(s.fecha_solicitud)  = ?
       ORDER BY s.fecha_solicitud DESC`,
      [anio, anio, mes, anio, anio, mes, sucursalId, mes, anio],
    )) as any[]

    const tablaMensual = conSueldo.map(p => {
      const sueldoBase = toNumber(p.sueldo_base)
      const valorHora = toNumber(p.valor_hora)
      const valorHoraCalculado = valorHora || (sueldoBase > 0 ? sueldoBase / 26 / 8 : 0)
      const solicitudes = solicitudesMap.get(Number(p.id))
      const novedad = novedadesMap.get(Number(p.id))
      const incentivoItemsBase: IncentivoPeriodo[] = incentivosGlobales.map((i: any) => {
        const v = toNumber(i.valor)
        let monto: number
        if (i.metodo_calculo === 'monto_fijo') monto = v
        else if (i.metodo_calculo === 'porcentaje_escala') monto = Math.round(sueldoBase * v) / 100
        else monto = Math.round(valorHoraCalculado * v * 100) / 100
        return { id: Number(i.id), nombre: String(i.nombre), monto }
      })
      const ajustes = ajustesMap.get(Number(p.id))
      const selectedIdsFromAjuste = parseSelectedIds(ajustes?.incentivos_seleccionados)
      const selectedIds =
        solicitudes?.novedadIncentivoIds ?? selectedIdsFromAjuste ?? incentivoItemsBase.map(item => item.id)
      const incentivos =
        incentivoItemsBase.filter(item => selectedIds.includes(item.id)).reduce((sum, item) => sum + item.monto, 0) +
        toNumber(solicitudes?.incentivos)
      const descuentos = toNumber(solicitudes?.descuentos)
      const adelantos = toNumber(solicitudes?.adelantos)
      const horasExtraImporte = toNumber(solicitudes?.horasExtraHoras) * valorHoraCalculado * 1.5
      const horasFeriadoImporte = toNumber(solicitudes?.horasFeriadoHoras) * valorHoraCalculado
      const ausenciasJustificadasImporte = toNumber(solicitudes?.ausenciasJustificadasHoras) * valorHoraCalculado
      const ausenciasInjustificadasImporte = toNumber(solicitudes?.ausenciasInjustificadasHoras) * valorHoraCalculado
      const tardanzasImporte = toNumber(solicitudes?.tardanzasHoras) * valorHoraCalculado
      const base = {
        personal_id: Number(p.id),
        nombre: p.nombre,
        colaborador: p.nombre,
        legajo: p.legajo,
        puesto: p.puesto,
        escala: sueldoBase,
        valor_hora_escala: valorHora,
        aplica_valor_hora: valorHora > 0,
        aplica_sueldo_basico_escala: true,
        aplica_horas_extra: toNumber(solicitudes?.horasExtraHoras) > 0,
        aplica_incentivos: selectedIds.length > 0,
        aplica_banco: p.forma_cobro !== 'efectivo',
        hs_realizadas_mes: toNumber(solicitudes?.horasTrabajadas),
        valor_hora: valorHora,
        sueldo_basico: sueldoBase,
        horas_extra_50: Math.round(horasExtraImporte || toNumber(solicitudes?.horasExtraImporte)),
        horas_extra_hs: toNumber(solicitudes?.horasExtraHoras),
        horas_feriado: Math.round(horasFeriadoImporte),
        horas_feriado_hs: toNumber(solicitudes?.horasFeriadoHoras),
        incentivos: Math.round(incentivos),
        incentivos_seleccionados: selectedIds,
        incentivos_items: incentivoItemsBase.map(item => ({
          ...item,
          selected: selectedIds.includes(item.id),
        })),
        extras: 0,
        ausencias_justificadas: Math.round(
          ausenciasJustificadasImporte || toNumber(solicitudes?.ausenciasJustificadas),
        ),
        ausencias_justificadas_hs: toNumber(solicitudes?.ausenciasJustificadasHoras),
        ausencias_injustificadas: Math.round(ausenciasInjustificadasImporte),
        ausencias_injustificadas_hs: toNumber(solicitudes?.ausenciasInjustificadasHoras),
        tardanzas: Math.round(tardanzasImporte),
        tardanzas_hs: toNumber(solicitudes?.tardanzasHoras),
        descuentos,
        adelantos,
        sueldo_sac: esMesSac(mes) ? Math.round(sueldoBase / 2) : 0,
        sueldo_neto: 0,
        banco: 0,
        efectivo: 0,
        fecha_deposito: '',
        sueldo_pagado: false,
        comentario_cobro: '',
        comentarios_count: Number(p.comentarios_count) || 0,
        tiene_comentarios: Number(p.comentarios_count) > 0,
        fa: '',
        fb: '',
        forma_cobro: p.forma_cobro,
        es_mes_sac: esMesSac(mes),
        enviado_pagos: false,
        fecha_enviado_pagos: '',
      }

      const withAjustes = applyAjustes(base, ajustes)
      withAjustes.incentivos_seleccionados = selectedIds
      withAjustes.incentivos_items = incentivoItemsBase.map(item => ({
        ...item,
        selected: selectedIds.includes(item.id),
      }))
      // SAC fuera de jun/dic siempre 0
      if (!esMesSac(mes)) withAjustes.sueldo_sac = 0
      withAjustes.enviado_pagos = Boolean((ajustes as any)?.enviado_pagos)
      withAjustes.fecha_enviado_pagos = (ajustes as any)?.fecha_enviado_pagos
        ? String((ajustes as any).fecha_enviado_pagos)
        : ''
      withAjustes.sueldo_neto = Math.round(
        ajustesMap.get(Number(p.id))?.sueldo_neto != null
          ? toNumber(withAjustes.sueldo_neto)
          : calculateNeto(withAjustes, mes),
      )
      const distribution = distributeByFormaCobro(withAjustes, String(p.forma_cobro))
      withAjustes.banco = ajustesMap.get(Number(p.id))?.banco != null ? toNumber(withAjustes.banco) : distribution.banco
      withAjustes.efectivo =
        ajustesMap.get(Number(p.id))?.efectivo != null ? toNumber(withAjustes.efectivo) : distribution.efectivo

      if (novedad?.tieneNovedadSueldo) {
        const simulacionSelectedIds = novedad.novedadIncentivoIds ?? selectedIds
        const simulacionValorHora =
          toNumber(withAjustes.valor_hora) ||
          (toNumber(withAjustes.sueldo_basico) > 0 ? toNumber(withAjustes.sueldo_basico) / 26 / 8 : 0)
        const simulacion = {
          ...withAjustes,
          aplica_horas_extra: toNumber(novedad.horasExtraHoras) > 0,
          aplica_incentivos: simulacionSelectedIds.length > 0,
          hs_realizadas_mes: toNumber(novedad.horasTrabajadas),
          horas_extra_50: Math.round(toNumber(novedad.horasExtraHoras) * simulacionValorHora * 1.5),
          horas_extra_hs: toNumber(novedad.horasExtraHoras),
          horas_feriado: Math.round(toNumber(novedad.horasFeriadoHoras) * simulacionValorHora),
          horas_feriado_hs: toNumber(novedad.horasFeriadoHoras),
          incentivos: Math.round(
            incentivoItemsBase
              .filter(item => simulacionSelectedIds.includes(item.id))
              .reduce((sum, item) => sum + item.monto, 0) + toNumber(novedad.incentivos),
          ),
          incentivos_seleccionados: simulacionSelectedIds,
          incentivos_items: incentivoItemsBase.map(item => ({
            ...item,
            selected: simulacionSelectedIds.includes(item.id),
          })),
          ausencias_justificadas: Math.round(toNumber(novedad.ausenciasJustificadasHoras) * simulacionValorHora),
          ausencias_justificadas_hs: toNumber(novedad.ausenciasJustificadasHoras),
          ausencias_injustificadas: Math.round(toNumber(novedad.ausenciasInjustificadasHoras) * simulacionValorHora),
          ausencias_injustificadas_hs: toNumber(novedad.ausenciasInjustificadasHoras),
          tardanzas: Math.round(toNumber(novedad.tardanzasHoras) * simulacionValorHora),
          tardanzas_hs: toNumber(novedad.tardanzasHoras),
          descuentos: toNumber(novedad.descuentos),
        }
        simulacion.sueldo_neto = Math.round(calculateNeto(simulacion, mes))
        const simulacionDistribution = distributeByFormaCobro(simulacion, String(p.forma_cobro))
        simulacion.banco = p.forma_cobro === 'efectivo' ? 0 : simulacionDistribution.banco
        simulacion.efectivo = p.forma_cobro === 'efectivo' ? simulacionDistribution.efectivo : 0

        return { ...withAjustes, simulacion }
      }

      return withAjustes
    })

    const masaSalarial = tablaMensual.reduce((s, p) => s + toNumber(p.sueldo_neto), 0)
    const colaboradoresBanco = tablaMensual.filter(p => p.forma_cobro === 'banco').length
    const colaboradoresEfectivo = tablaMensual.filter(p => p.forma_cobro === 'efectivo').length
    const totalBanco = tablaMensual.reduce((s, p) => s + toNumber(p.banco), 0)
    const totalEfectivo = tablaMensual.reduce((s, p) => s + toNumber(p.efectivo), 0)

    const puestoMap = new Map<
      number,
      { puesto_id: number; puesto: string; colaboradores: number; masa_salarial: number }
    >()
    for (const p of tablaMensual) {
      const puestoId = Number(conSueldo.find(row => Number(row.id) === p.personal_id)?.puesto_id)
      if (!puestoMap.has(puestoId)) {
        puestoMap.set(puestoId, { puesto_id: puestoId, puesto: String(p.puesto), colaboradores: 0, masa_salarial: 0 })
      }
      const item = puestoMap.get(puestoId)!
      item.colaboradores++
      item.masa_salarial += toNumber(p.sueldo_neto)
    }

    const porPuesto = [...puestoMap.values()]
      .map(e => ({ ...e, sueldo_promedio: e.colaboradores > 0 ? Math.round(e.masa_salarial / e.colaboradores) : 0 }))
      .sort((a, b) => b.masa_salarial - a.masa_salarial)

    res.json({
      success: true,
      data: {
        periodo: { mes, anio, label: `${MESES[mes - 1]} ${anio}` },
        resumen: {
          total_colaboradores: tablaMensual.length,
          masa_salarial: masaSalarial,
          sueldo_promedio: tablaMensual.length > 0 ? Math.round(masaSalarial / tablaMensual.length) : 0,
          liquidaciones_finales_count: liquidacionesRows.length,
          total_banco: totalBanco,
          total_efectivo: totalEfectivo,
          pct_banco: masaSalarial > 0 ? Math.round((totalBanco / masaSalarial) * 100) : 0,
          pct_efectivo: masaSalarial > 0 ? Math.round((totalEfectivo / masaSalarial) * 100) : 0,
          colaboradores_banco: colaboradoresBanco,
          colaboradores_efectivo: colaboradoresEfectivo,
        },
        por_puesto: porPuesto,
        tabla_mensual: tablaMensual,
        liquidaciones: liquidacionesRows.map(l => {
          const detalles = parseDetalles(l.detalles)
          const sueldoBase = toNumber(l.sueldo_base)
          const valorHoraEscala = toNumber(l.valor_hora_escala)
          const formaCobro = String(l.forma_cobro ?? 'banco')
          const hasAjuste = l.aj_sueldo_neto != null

          // Incentivos globales del período filtrados para esta liquidación
          const selectedIdsFromAjuste = parseSelectedIds(l.aj_incentivos_seleccionados)
          const selectedIds = selectedIdsFromAjuste ?? incentivosGlobales.map((i: any) => Number(i.id))
          const incentivoItemsBase: IncentivoPeriodo[] = incentivosGlobales.map((i: any) => {
            const v = toNumber(i.valor)
            let monto: number
            if (i.metodo_calculo === 'monto_fijo') monto = v
            else if (i.metodo_calculo === 'porcentaje_escala') monto = Math.round(sueldoBase * v) / 100
            else {
              const vh = valorHoraEscala || (sueldoBase > 0 ? sueldoBase / 26 / 8 : 0)
              monto = Math.round(vh * v * 100) / 100
            }
            return { id: Number(i.id), nombre: String(i.nombre), monto }
          })

          const fa = l.fa ? String(l.fa) : ''
          const fb = detalles.fecha_baja ? String(detalles.fecha_baja) : ''
          const defaults = computeLiqFinalDefaults(fa, fb, sueldoBase)

          const base = {
            liquidacion_id: Number(l.id),
            personal_id: Number(l.personal_id),
            nombre: String(l.nombre),
            legajo: String(l.legajo),
            puesto: String(l.puesto),
            fa,
            fb,
            antiguedad_anios: defaults.antiguedadAnios,
            antiguedad_texto: defaults.antiguedadTexto,
            sac_auto: defaults.sac,
            vng_auto: defaults.vng,
            preaviso_auto: defaults.preaviso,
            forma_cobro: formaCobro,
            estado: String(l.estado),
            fecha_solicitud: l.fecha_solicitud,
            escala: sueldoBase,
            valor_hora_escala: valorHoraEscala,
            aplica_valor_hora: hasAjuste ? Boolean(l.aj_aplica_valor_hora) : valorHoraEscala > 0,
            aplica_sueldo_basico_escala: hasAjuste ? Boolean(l.aj_aplica_sueldo_basico_escala) : true,
            aplica_banco: hasAjuste ? Boolean(l.aj_aplica_banco) : formaCobro !== 'efectivo',
            aplica_horas_extra: hasAjuste ? Boolean(l.aj_aplica_horas_extra) : false,
            aplica_incentivos: hasAjuste ? Boolean(l.aj_aplica_incentivos) : selectedIds.length > 0,
            hs_realizadas_mes: 0,
            valor_hora: hasAjuste && l.aj_valor_hora != null ? toNumber(l.aj_valor_hora) : valorHoraEscala,
            sueldo_basico: hasAjuste && l.aj_sueldo_basico != null ? toNumber(l.aj_sueldo_basico) : sueldoBase,
            horas_extra_50: hasAjuste ? toNumber(l.aj_horas_extra_50) : 0,
            horas_extra_hs: hasAjuste ? toNumber(l.aj_horas_extra_hs) : 0,
            horas_feriado: hasAjuste ? toNumber(l.aj_horas_feriado) : 0,
            horas_feriado_hs: hasAjuste ? toNumber(l.aj_horas_feriado_hs) : 0,
            incentivos: hasAjuste
              ? toNumber(l.aj_incentivos)
              : Math.round(incentivoItemsBase.filter(i => selectedIds.includes(i.id)).reduce((s, i) => s + i.monto, 0)),
            incentivos_seleccionados: selectedIds,
            incentivos_items: incentivoItemsBase.map(i => ({ ...i, selected: selectedIds.includes(i.id) })),
            extras: hasAjuste ? toNumber(l.aj_extras) : 0,
            ausencias_justificadas: hasAjuste ? toNumber(l.aj_ausencias_justificadas) : 0,
            ausencias_injustificadas: hasAjuste ? toNumber(l.aj_ausencias_injustificadas) : 0,
            tardanzas: hasAjuste ? toNumber(l.aj_tardanzas) : 0,
            descuentos: hasAjuste ? toNumber(l.aj_descuentos) : 0,
            adelantos: hasAjuste ? toNumber(l.aj_adelantos) : 0,
            sueldo_neto: hasAjuste ? toNumber(l.aj_sueldo_neto) : sueldoBase,
            banco: hasAjuste ? toNumber(l.aj_banco) : formaCobro !== 'efectivo' ? sueldoBase : 0,
            efectivo: hasAjuste ? toNumber(l.aj_efectivo) : formaCobro === 'efectivo' ? sueldoBase : 0,
            sac_porcentaje: hasAjuste ? toNumber(l.aj_sac_porcentaje) : 0,
            sac_importe: hasAjuste ? toNumber(l.aj_sac_importe) : defaults.sac,
            vng_porcentaje: hasAjuste ? toNumber(l.aj_vng_porcentaje) : 0,
            vng_importe: hasAjuste ? toNumber(l.aj_vng_importe) : defaults.vng,
            preaviso_porcentaje: hasAjuste ? toNumber(l.aj_preaviso_porcentaje) : 0,
            preaviso_importe: hasAjuste ? toNumber(l.aj_preaviso_importe) : defaults.preaviso,
            total_liq: hasAjuste ? toNumber(l.aj_total_liq) : defaults.sac + defaults.vng + defaults.preaviso,
            liq_banco: hasAjuste
              ? toNumber(l.aj_liq_banco)
              : formaCobro !== 'efectivo'
                ? defaults.sac + defaults.vng + defaults.preaviso
                : 0,
            liq_efectivo: hasAjuste
              ? toNumber(l.aj_liq_efectivo)
              : formaCobro === 'efectivo'
                ? defaults.sac + defaults.vng + defaults.preaviso
                : 0,
            total_general: hasAjuste
              ? toNumber(l.aj_total_general)
              : sueldoBase + defaults.sac + defaults.vng + defaults.preaviso,
            sueldo_pagado: Boolean(l.aj_sueldo_pagado),
            fecha_deposito: l.aj_fecha_deposito ?? '',
            comentario_cobro: l.aj_comentario_cobro ?? '',
            ministerio_aplica: Boolean(l.aj_ministerio_aplica),
            ministerio_direccion: l.aj_ministerio_direccion ?? '',
            ministerio_fecha: l.aj_ministerio_fecha ?? '',
            ministerio_horario: l.aj_ministerio_horario ?? '',
            enviado_pagos: Boolean(l.aj_enviado_pagos),
            fecha_enviado_pagos: l.aj_fecha_enviado_pagos ? String(l.aj_fecha_enviado_pagos) : '',
          }

          return base
        }),
        colaboradores: personalRows.map(p => ({
          id: p.id,
          nombre: p.nombre,
          legajo: p.legajo,
          puesto: p.puesto,
        })),
      },
    })
  } catch (error) {
    console.error('Error al obtener sueldos del período:', error)
    res.status(500).json({ success: false, message: 'Error al obtener sueldos del período' })
  }
}

// PUT /api/rrhh/sueldos/:personalId/periodo?sucursal_id=X&mes=M&anio=A
export const updateSueldoPeriodo = async (req: Request, res: Response) => {
  try {
    const personalId = Number(req.params.personalId)
    const sucursalId = Number(req.query.sucursal_id ?? req.body.sucursal_id)
    const { mes, anio } = parsePeriodo(req)

    if (!personalId || !sucursalId) {
      return res.status(400).json({ success: false, message: 'personal_id y sucursal_id son requeridos' })
    }
    if (mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({ success: false, message: 'Período inválido' })
    }

    const payload = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body
    const values = AJUSTE_FIELDS.map(field => {
      const value = payload[field]
      if (value === undefined || value === '') return null
      if (field === 'incentivos_seleccionados') {
        return Array.isArray(value) ? JSON.stringify(value.map(Number).filter(Number.isFinite)) : String(value)
      }
      if (NUMERIC_AJUSTE_FIELDS.includes(field)) return toNumber(value)
      return value
    })

    await query(
      `INSERT INTO rrhh_sueldos_periodo_ajustes
       (personal_id, sucursal_id, mes, anio, ${AJUSTE_FIELDS.join(', ')})
       VALUES (?, ?, ?, ?, ${AJUSTE_FIELDS.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE
       sucursal_id = VALUES(sucursal_id),
       ${AJUSTE_FIELDS.map(field => `${field} = VALUES(${field})`).join(', ')}`,
      [personalId, sucursalId, mes, anio, ...values],
    )

    res.json({ success: true, message: 'Sueldo del período actualizado' })
  } catch (error) {
    console.error('Error al actualizar sueldo del período:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar sueldo del período' })
  }
}

const LIQ_FINAL_AJUSTE_NUMERIC = [
  'aplica_valor_hora',
  'aplica_sueldo_basico_escala',
  'aplica_banco',
  'aplica_horas_extra',
  'aplica_incentivos',
  'valor_hora',
  'sueldo_basico',
  'horas_extra_50',
  'horas_extra_hs',
  'horas_feriado',
  'horas_feriado_hs',
  'incentivos',
  'extras',
  'ausencias_justificadas',
  'ausencias_injustificadas',
  'tardanzas',
  'descuentos',
  'adelantos',
  'sueldo_neto',
  'banco',
  'efectivo',
  'sac_porcentaje',
  'sac_importe',
  'vng_porcentaje',
  'vng_importe',
  'preaviso_porcentaje',
  'preaviso_importe',
  'total_liq',
  'liq_banco',
  'liq_efectivo',
  'total_general',
  'sueldo_pagado',
  'ministerio_aplica',
] as const

const LIQ_FINAL_AJUSTE_TEXT = ['comentario_cobro', 'ministerio_direccion', 'ministerio_horario'] as const
const LIQ_FINAL_AJUSTE_DATE = ['ministerio_fecha', 'fecha_deposito'] as const
const LIQ_FINAL_AJUSTE_JSON = ['incentivos_seleccionados'] as const

const LIQ_FINAL_ALL_FIELDS = [
  ...LIQ_FINAL_AJUSTE_NUMERIC,
  ...LIQ_FINAL_AJUSTE_TEXT,
  ...LIQ_FINAL_AJUSTE_DATE,
  ...LIQ_FINAL_AJUSTE_JSON,
] as const

function parseHoraToTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hh = String(Math.min(23, Number(match[1]))).padStart(2, '0')
  return `${hh}:${match[2]}:00`
}

// Crea/actualiza/elimina el evento de Calendario asociado al trámite de Ministerio
async function syncMinisterioEvento(liquidacionId: number, creadoPor: number | null): Promise<void> {
  try {
    const rows = (await query(
      `SELECT lfa.ministerio_aplica, lfa.ministerio_direccion, lfa.ministerio_horario,
              DATE_FORMAT(lfa.ministerio_fecha, '%Y-%m-%d') AS ministerio_fecha,
              lfa.calendario_evento_id, p.nombre
       FROM rrhh_liquidaciones_finales_ajustes lfa
       JOIN rrhh_liquidaciones_finales lf ON lf.id = lfa.liquidacion_id
       JOIN personal p ON p.id = lf.personal_id
       WHERE lfa.liquidacion_id = ?`,
      [liquidacionId],
    )) as any[]
    if (!rows.length) return
    const row = rows[0]
    const eventoId = row.calendario_evento_id ? Number(row.calendario_evento_id) : null
    const aplica = Boolean(row.ministerio_aplica) && Boolean(row.ministerio_fecha)

    if (!aplica) {
      if (eventoId) {
        await query('UPDATE rrhh_calendario_eventos SET deleted_at = NOW() WHERE id = ?', [eventoId])
        await query(
          'UPDATE rrhh_liquidaciones_finales_ajustes SET calendario_evento_id = NULL WHERE liquidacion_id = ?',
          [liquidacionId],
        )
      }
      return
    }

    const evento = `Trámite Ministerio · ${row.nombre}`
    const hora = parseHoraToTime(row.ministerio_horario)
    const direccion = row.ministerio_direccion || null
    const comentarios = 'Liquidación final de baja. Recordar llevar DNI.'

    if (eventoId) {
      await query(
        `UPDATE rrhh_calendario_eventos
         SET evento = ?, fecha = ?, hora = ?, direccion = ?, comentarios = ?, tipo_notion = 'Ministerio', deleted_at = NULL
         WHERE id = ?`,
        [evento, row.ministerio_fecha, hora, direccion, comentarios, eventoId],
      )
    } else {
      const result = (await query(
        `INSERT INTO rrhh_calendario_eventos
         (evento, fecha, hora, direccion, comentarios, tipo_notion, creado_por)
         VALUES (?, ?, ?, ?, ?, 'Ministerio', ?)`,
        [evento, row.ministerio_fecha, hora, direccion, comentarios, creadoPor],
      )) as any
      await query('UPDATE rrhh_liquidaciones_finales_ajustes SET calendario_evento_id = ? WHERE liquidacion_id = ?', [
        Number(result.insertId),
        liquidacionId,
      ])
    }
  } catch (error) {
    console.error('Error al sincronizar evento de Ministerio:', error)
  }
}

// PUT /api/rrhh/sueldos/liquidaciones/:liquidacionId
export const updateLiquidacionFinalAjustes = async (req: Request, res: Response) => {
  try {
    const liquidacionId = Number(req.params.liquidacionId)
    if (!liquidacionId) {
      return res.status(400).json({ success: false, message: 'liquidacionId es requerido' })
    }

    const checkRows = (await query('SELECT id FROM rrhh_liquidaciones_finales WHERE id = ?', [liquidacionId])) as any[]
    if (!checkRows.length) {
      return res.status(404).json({ success: false, message: 'Liquidación no encontrada' })
    }

    const payload = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body

    const values = LIQ_FINAL_ALL_FIELDS.map(field => {
      const val = payload[field]
      if (val === undefined || val === '') return null
      if ((LIQ_FINAL_AJUSTE_JSON as readonly string[]).includes(field)) {
        return Array.isArray(val) ? JSON.stringify(val.map(Number).filter(Number.isFinite)) : String(val)
      }
      if ((LIQ_FINAL_AJUSTE_TEXT as readonly string[]).includes(field)) {
        return String(val ?? '').trim() || null
      }
      if ((LIQ_FINAL_AJUSTE_DATE as readonly string[]).includes(field)) {
        return val || null
      }
      return toNumber(val)
    })

    await query(
      `INSERT INTO rrhh_liquidaciones_finales_ajustes
       (liquidacion_id, ${LIQ_FINAL_ALL_FIELDS.join(', ')})
       VALUES (?, ${LIQ_FINAL_ALL_FIELDS.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE
       ${LIQ_FINAL_ALL_FIELDS.map(f => `${f} = VALUES(${f})`).join(', ')}`,
      [liquidacionId, ...values],
    )

    await syncMinisterioEvento(liquidacionId, req.user?.id ?? null)

    res.json({ success: true, message: 'Liquidación final actualizada' })
  } catch (error) {
    console.error('Error al actualizar liquidación final:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar liquidación final' })
  }
}

// POST /api/rrhh/sueldos/liquidaciones/:liquidacionId/enviar-pagos
export const enviarLiquidacionAPagos = async (req: Request, res: Response) => {
  try {
    const liquidacionId = Number(req.params.liquidacionId)
    const userId = req.body.user_id != null ? Number(req.body.user_id) : (req.user?.id ?? null)
    if (!liquidacionId) {
      return res.status(400).json({ success: false, message: 'liquidacionId es requerido' })
    }

    const rows = (await query(
      `SELECT lfa.banco, lfa.efectivo, lfa.liq_banco, lfa.liq_efectivo, lfa.total_general, lfa.enviado_pagos,
              p.nombre, p.legajo, p.sucursal_id
       FROM rrhh_liquidaciones_finales_ajustes lfa
       JOIN rrhh_liquidaciones_finales lf ON lf.id = lfa.liquidacion_id
       JOIN personal p ON p.id = lf.personal_id
       WHERE lfa.liquidacion_id = ?`,
      [liquidacionId],
    )) as any[]

    if (!rows.length) {
      return res
        .status(400)
        .json({ success: false, message: 'Guardá la liquidación antes de enviarla a Pagos Pendientes' })
    }
    const row = rows[0]
    if (Number(row.enviado_pagos) === 1) {
      return res.status(409).json({ success: false, message: 'Esta liquidación ya fue enviada a Pagos Pendientes' })
    }

    const sucursalId = Number(row.sucursal_id)
    const bancoTotal = toNumber(row.banco) + toNumber(row.liq_banco)
    const efectivoTotal = toNumber(row.efectivo) + toNumber(row.liq_efectivo)
    if (bancoTotal <= 0 && efectivoTotal <= 0) {
      return res.status(400).json({ success: false, message: 'La liquidación no tiene importes para enviar' })
    }

    const fecha = new Date().toISOString().slice(0, 10)
    const nombre = String(row.nombre ?? '').trim() || `Legajo ${row.legajo}`
    const concepto = `Liquidación final · ${nombre}`

    let movBancoId: number | null = null
    let movEfectivoId: number | null = null
    if (bancoTotal > 0) movBancoId = await crearMovimientoPago(sucursalId, userId, fecha, concepto, bancoTotal, 'banco')
    if (efectivoTotal > 0)
      movEfectivoId = await crearMovimientoPago(sucursalId, userId, fecha, concepto, efectivoTotal, 'efectivo')

    await query(
      `UPDATE rrhh_liquidaciones_finales_ajustes
       SET enviado_pagos = 1, fecha_enviado_pagos = NOW(), movimiento_banco_id = ?, movimiento_efectivo_id = ?
       WHERE liquidacion_id = ?`,
      [movBancoId, movEfectivoId, liquidacionId],
    )

    // Notificar al responsable de RRHH
    const destinatario = process.env.RRHH_RESPONSABLE_EMAIL || process.env.EMAIL_APROBACION
    if (destinatario) {
      const html = `
        <div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#1a1a1a">
          <h2 style="color:#9f1239">Liquidación final enviada a Pagos Pendientes</h2>
          <p>Se generó el pago de la liquidación final de <strong>${nombre}</strong> (Leg. ${row.legajo}).</p>
          <ul>
            <li>Total general: <strong>$${toNumber(row.total_general).toLocaleString('es-AR')}</strong></li>
            <li>Banco: $${bancoTotal.toLocaleString('es-AR')}</li>
            <li>Efectivo: $${efectivoTotal.toLocaleString('es-AR')}</li>
          </ul>
          <p style="color:#6b7280">Revisá y aprobá el movimiento en el módulo de Pagos Pendientes.</p>
        </div>`
      sendNotificacionEmail([destinatario], `[Heroica] Liquidación final · ${nombre}`, html).catch(() => {})
    }

    res.json({ success: true, message: 'Liquidación final enviada a Pagos Pendientes' })
  } catch (error) {
    console.error('Error al enviar liquidación a pagos pendientes:', error)
    res.status(500).json({ success: false, message: 'Error al enviar liquidación a Pagos Pendientes' })
  }
}

// PUT /api/rrhh/sueldos/:personalId/periodo/meta?sucursal_id=X&mes=M&anio=A
export const updateSueldoPeriodoMeta = async (req: Request, res: Response) => {
  try {
    const personalId = Number(req.params.personalId)
    const sucursalId = Number(req.query.sucursal_id ?? req.body.sucursal_id)
    const { mes, anio } = parsePeriodo(req)

    if (!personalId || !sucursalId) {
      return res.status(400).json({ success: false, message: 'personal_id y sucursal_id son requeridos' })
    }
    if (mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({ success: false, message: 'Período inválido' })
    }

    const payload = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body
    const updates: string[] = ['sucursal_id = VALUES(sucursal_id)']
    const columns = ['personal_id', 'sucursal_id', 'mes', 'anio']
    const values: unknown[] = [personalId, sucursalId, mes, anio]

    if (payload.sueldo_pagado !== undefined) {
      columns.push('sueldo_pagado')
      values.push(payload.sueldo_pagado ? 1 : 0)
      updates.push('sueldo_pagado = VALUES(sueldo_pagado)')
    }

    if (payload.comentario_cobro !== undefined) {
      columns.push('comentario_cobro')
      values.push(String(payload.comentario_cobro ?? '').trim() || null)
      updates.push('comentario_cobro = VALUES(comentario_cobro)')
    }

    if (columns.length === 4) {
      return res.status(400).json({ success: false, message: 'No hay datos para actualizar' })
    }

    await query(
      `INSERT INTO rrhh_sueldos_periodo_ajustes
       (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${updates.join(', ')}`,
      values,
    )

    res.json({ success: true, message: 'Datos del cobro actualizados' })
  } catch (error) {
    console.error('Error al actualizar datos del cobro:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar datos del cobro' })
  }
}

interface EnviarPagoRow {
  personal_id: number
  nombre?: string
  sueldo_neto?: number
  banco?: number
  efectivo?: number
  fecha_deposito?: string
}

async function crearMovimientoPago(
  sucursalId: number,
  userId: number | null,
  fecha: string,
  concepto: string,
  monto: number,
  destinoCaja: 'banco' | 'efectivo',
): Promise<number> {
  const result = (await query(
    `INSERT INTO movimientos
     (sucursal_id, user_id, fecha, concepto, comentarios, monto, tipo_movimiento, saldo, prioridad, estado, tipo, moneda)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'saldo_necesario', 'media', 'pendiente', 'egreso', 'ARS')`,
    [sucursalId, userId, fecha, concepto, 'Generado desde RRHH · Sueldos', -Math.abs(monto), destinoCaja],
  )) as any
  return Number(result.insertId)
}

// POST /api/rrhh/sueldos/enviar-pagos
export const enviarSueldosAPagos = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.body.sucursal_id)
    const userId = req.body.user_id != null ? Number(req.body.user_id) : null
    const mes = Number(req.body.mes)
    const anio = Number(req.body.anio)
    const rows: EnviarPagoRow[] = Array.isArray(req.body.rows) ? req.body.rows : []

    if (!sucursalId || !mes || !anio) {
      return res.status(400).json({ success: false, message: 'sucursal_id, mes y anio son requeridos' })
    }
    if (mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({ success: false, message: 'Período inválido' })
    }
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'No hay sueldos para enviar' })
    }

    // Ajustes ya existentes para detectar los que ya fueron enviados
    const personalIds = rows.map(r => Number(r.personal_id)).filter(Number.isFinite)
    const existentes = personalIds.length
      ? ((await query(
          `SELECT personal_id, enviado_pagos FROM rrhh_sueldos_periodo_ajustes
           WHERE personal_id IN (${personalIds.map(() => '?').join(',')}) AND mes = ? AND anio = ?`,
          [...personalIds, mes, anio],
        )) as any[])
      : []
    const yaEnviado = new Set(existentes.filter(e => Number(e.enviado_pagos) === 1).map(e => Number(e.personal_id)))

    const fecha = `${anio}-${String(mes).padStart(2, '0')}-01`
    const mesLabel = `${MESES[mes - 1]} ${anio}`
    let enviados = 0
    const omitidos: number[] = []

    for (const row of rows) {
      const personalId = Number(row.personal_id)
      if (!Number.isFinite(personalId)) continue
      if (yaEnviado.has(personalId)) {
        omitidos.push(personalId)
        continue
      }

      const banco = toNumber(row.banco)
      const efectivo = toNumber(row.efectivo)
      const neto = toNumber(row.sueldo_neto)
      if (neto <= 0 && banco <= 0 && efectivo <= 0) {
        omitidos.push(personalId)
        continue
      }

      const nombre = String(row.nombre ?? '').trim() || `Legajo ${personalId}`
      const concepto = `Sueldo ${mesLabel} · ${nombre}`

      let movBancoId: number | null = null
      let movEfectivoId: number | null = null
      if (banco > 0) movBancoId = await crearMovimientoPago(sucursalId, userId, fecha, concepto, banco, 'banco')
      if (efectivo > 0)
        movEfectivoId = await crearMovimientoPago(sucursalId, userId, fecha, concepto, efectivo, 'efectivo')

      await query(
        `INSERT INTO rrhh_sueldos_periodo_ajustes
         (personal_id, sucursal_id, mes, anio, sueldo_neto, banco, efectivo,
          enviado_pagos, fecha_enviado_pagos, movimiento_banco_id, movimiento_efectivo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), ?, ?)
         ON DUPLICATE KEY UPDATE
           sucursal_id = VALUES(sucursal_id),
           sueldo_neto = VALUES(sueldo_neto),
           banco = VALUES(banco),
           efectivo = VALUES(efectivo),
           enviado_pagos = 1,
           fecha_enviado_pagos = NOW(),
           movimiento_banco_id = VALUES(movimiento_banco_id),
           movimiento_efectivo_id = VALUES(movimiento_efectivo_id)`,
        [personalId, sucursalId, mes, anio, neto, banco, efectivo, movBancoId, movEfectivoId],
      )
      enviados++
    }

    res.json({
      success: true,
      message:
        enviados > 0 ? `${enviados} sueldo(s) enviado(s) a Pagos Pendientes` : 'No había sueldos nuevos para enviar',
      data: { enviados, omitidos: omitidos.length },
    })
  } catch (error) {
    console.error('Error al enviar sueldos a pagos pendientes:', error)
    res.status(500).json({ success: false, message: 'Error al enviar sueldos a Pagos Pendientes' })
  }
}
