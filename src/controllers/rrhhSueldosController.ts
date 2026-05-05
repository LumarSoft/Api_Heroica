import { Request, Response } from 'express'
import { query } from '../config/database'

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

function calculateNeto(row: Record<string, unknown>) {
  return (
    toNumber(row.sueldo_basico) +
    toNumber(row.horas_extra_50) +
    toNumber(row.horas_feriado) +
    toNumber(row.incentivos) +
    toNumber(row.extras) +
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

    const incentivosRows = (await query(
      `SELECT i.id,
              i.escala_salarial_id,
              i.nombre,
              CASE
                WHEN i.metodo_calculo = 'porcentaje_escala' THEN ROUND(COALESCE(e.sueldo_base, 0) * i.valor / 100, 2)
                WHEN i.metodo_calculo = 'multiplicador_valor_hora' THEN ROUND(COALESCE(e.valor_hora, 0) * i.valor, 2)
                ELSE i.valor
              END AS monto
       FROM rrhh_incentivos_premios i
       LEFT JOIN escalas_salariales e ON e.id = i.escala_salarial_id AND e.deleted_at IS NULL
       WHERE i.deleted_at IS NULL
         AND i.activo = 1
         AND i.sucursal_id = ?
         AND i.mes = ?
         AND i.anio = ?
       ORDER BY i.nombre ASC`,
      [sucursalId, mes, anio],
    )) as any[]
    const incentivosPorEscala = new Map<number, IncentivoPeriodo[]>()
    for (const row of incentivosRows) {
      const escalaId = Number(row.escala_salarial_id)
      if (!incentivosPorEscala.has(escalaId)) incentivosPorEscala.set(escalaId, [])
      incentivosPorEscala.get(escalaId)!.push({
        id: Number(row.id),
        nombre: String(row.nombre),
        monto: toNumber(row.monto),
      })
    }

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

    const liquidacionesRows = (await query(
      `SELECT
         rs.id,
         p.nombre,
         p.legajo,
         pu.nombre          AS puesto,
         rs.fecha_solicitud,
         rs.estado,
         rs.detalles
       FROM  rrhh_solicitudes rs
       JOIN  personal p
         ON  p.id = COALESCE(rs.personal_id, rs.personal_creado_id)
         AND p.deleted_at IS NULL
       JOIN  puestos pu ON pu.id = p.puesto_id AND pu.deleted_at IS NULL
       WHERE rs.tipo       = 'Liquidación Final'
         AND rs.deleted_at IS NULL
         AND p.sucursal_id = ?
         AND MONTH(rs.fecha_solicitud) = ?
         AND YEAR(rs.fecha_solicitud)  = ?
       ORDER BY rs.fecha_solicitud DESC`,
      [sucursalId, mes, anio],
    )) as any[]

    const tablaMensual = conSueldo.map(p => {
      const sueldoBase = toNumber(p.sueldo_base)
      const valorHora = toNumber(p.valor_hora)
      const solicitudes = solicitudesMap.get(Number(p.id))
      const novedad = novedadesMap.get(Number(p.id))
      const incentivoItemsBase = incentivosPorEscala.get(Number(p.escala_id)) ?? []
      const ajustes = ajustesMap.get(Number(p.id))
      const selectedIdsFromAjuste = parseSelectedIds(ajustes?.incentivos_seleccionados)
      const selectedIds =
        solicitudes?.novedadIncentivoIds ?? selectedIdsFromAjuste ?? incentivoItemsBase.map(item => item.id)
      const incentivos =
        incentivoItemsBase.filter(item => selectedIds.includes(item.id)).reduce((sum, item) => sum + item.monto, 0) +
        toNumber(solicitudes?.incentivos)
      const descuentos = toNumber(solicitudes?.descuentos)
      const adelantos = toNumber(solicitudes?.adelantos)
      const valorHoraCalculado = valorHora || (sueldoBase > 0 ? sueldoBase / 26 / 8 : 0)
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
        sueldo_sac: 0,
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
      }

      const withAjustes = applyAjustes(base, ajustes)
      withAjustes.incentivos_seleccionados = selectedIds
      withAjustes.incentivos_items = incentivoItemsBase.map(item => ({
        ...item,
        selected: selectedIds.includes(item.id),
      }))
      withAjustes.sueldo_neto = Math.round(
        ajustesMap.get(Number(p.id))?.sueldo_neto != null
          ? toNumber(withAjustes.sueldo_neto)
          : calculateNeto(withAjustes),
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
        simulacion.sueldo_neto = Math.round(calculateNeto(simulacion))
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
        liquidaciones: liquidacionesRows.map(l => ({
          ...l,
          detalles: parseDetalles(l.detalles),
        })),
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
