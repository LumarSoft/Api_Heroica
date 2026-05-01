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

// GET /api/rrhh/sueldos?sucursal_id=X&mes=M&anio=A
export const getSueldosPeriodo = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.query.sucursal_id)
    if (!sucursalId) {
      return res.status(400).json({ success: false, message: 'sucursal_id es requerido' })
    }

    const hoy = new Date()
    const mes = req.query.mes ? Number(req.query.mes) : hoy.getMonth() + 1
    const anio = req.query.anio ? Number(req.query.anio) : hoy.getFullYear()

    if (mes < 1 || mes > 12 || anio < 2000 || anio > 2100) {
      return res.status(400).json({ success: false, message: 'Período inválido' })
    }

    // Todos los colaboradores activos con su sueldo vigente al período solicitado
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
           (SELECT es.sueldo_base
            FROM   escalas_salariales es
            WHERE  es.puesto_id   = p.puesto_id
              AND  es.deleted_at IS NULL
              AND  (es.anio < ? OR (es.anio = ? AND es.mes <= ?))
            ORDER  BY es.anio DESC, es.mes DESC
            LIMIT  1),
           0
         ) AS sueldo_base
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
      [anio, anio, mes, sucursalId],
    )) as any[]

    const conSueldo = personalRows.filter(p => Number(p.sueldo_base) > 0)

    // Liquidaciones finales del período
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

    // ── Aggregation ─────────────────────────────────────────────────────────

    const masaSalarial = conSueldo.reduce((s, p) => s + Number(p.sueldo_base), 0)
    const colaboradoresBanco = conSueldo.filter(p => p.forma_cobro === 'banco').length
    const colaboradoresEfectivo = conSueldo.filter(p => p.forma_cobro === 'efectivo').length
    const totalBanco = conSueldo.filter(p => p.forma_cobro === 'banco').reduce((s, p) => s + Number(p.sueldo_base), 0)
    const totalEfectivo = conSueldo
      .filter(p => p.forma_cobro === 'efectivo')
      .reduce((s, p) => s + Number(p.sueldo_base), 0)

    // Por puesto
    const puestoMap = new Map<
      number,
      {
        puesto_id: number
        puesto: string
        colaboradores: number
        masa_salarial: number
      }
    >()

    for (const p of conSueldo) {
      if (!puestoMap.has(p.puesto_id)) {
        puestoMap.set(p.puesto_id, { puesto_id: p.puesto_id, puesto: p.puesto, colaboradores: 0, masa_salarial: 0 })
      }
      const e = puestoMap.get(p.puesto_id)!
      e.colaboradores++
      e.masa_salarial += Number(p.sueldo_base)
    }

    const porPuesto = [...puestoMap.values()]
      .map(e => ({ ...e, sueldo_promedio: e.colaboradores > 0 ? Math.round(e.masa_salarial / e.colaboradores) : 0 }))
      .sort((a, b) => b.masa_salarial - a.masa_salarial)

    const tablaMensual = conSueldo.map(p => {
      const sueldoBase = Number(p.sueldo_base)
      const banco = p.forma_cobro === 'efectivo' ? 0 : sueldoBase
      const efectivo = p.forma_cobro === 'efectivo' ? sueldoBase : 0

      return {
        personal_id: p.id,
        nombre: p.nombre,
        legajo: p.legajo,
        puesto: p.puesto,
        escala: sueldoBase,
        banco,
        efectivo,
        comentarios_count: Number(p.comentarios_count) || 0,
        tiene_comentarios: Number(p.comentarios_count) > 0,
        fa: '',
        fb: '',
        forma_cobro: p.forma_cobro,
      }
    })

    res.json({
      success: true,
      data: {
        periodo: { mes, anio, label: `${MESES[mes - 1]} ${anio}` },
        resumen: {
          total_colaboradores: conSueldo.length,
          masa_salarial: masaSalarial,
          sueldo_promedio: conSueldo.length > 0 ? Math.round(masaSalarial / conSueldo.length) : 0,
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
          detalles: typeof l.detalles === 'string' ? JSON.parse(l.detalles) : (l.detalles ?? {}),
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
