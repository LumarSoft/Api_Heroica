import { Request, Response } from 'express'
import { query } from '../config/database'

/**
 * GET /api/rrhh/analitico/global
 * Dashboards globales de RRHH (evolución salarial, rotación, distribución).
 * Filtros opcionales: ?sucursal_id=, ?desde=YYYY-MM-DD, ?hasta=YYYY-MM-DD
 */
export const getAnaliticoGlobal = async (req: Request, res: Response) => {
  try {
    const sucursalId = req.query.sucursal_id ? Number(req.query.sucursal_id) : null
    const desde = typeof req.query.desde === 'string' && req.query.desde ? req.query.desde : null
    const hasta = typeof req.query.hasta === 'string' && req.query.hasta ? req.query.hasta : null

    // --- Personal activo: total + distribución por área y por puesto ---
    const personalWhere = ['p.deleted_at IS NULL', 'p.activo = 1']
    const personalParams: unknown[] = []
    if (sucursalId) {
      personalWhere.push('p.sucursal_id = ?')
      personalParams.push(sucursalId)
    }
    const personalWhereSql = personalWhere.join(' AND ')

    const distribucionArea = (await query(
      `SELECT COALESCE(a.nombre, 'Sin área') AS area, COUNT(*) AS cantidad
       FROM personal p
       LEFT JOIN puestos pu ON pu.id = p.puesto_id
       LEFT JOIN areas a ON a.id = pu.area_id
       WHERE ${personalWhereSql}
       GROUP BY area
       ORDER BY cantidad DESC`,
      personalParams,
    )) as Array<{ area: string; cantidad: number }>

    const distribucionPuesto = (await query(
      `SELECT COALESCE(pu.nombre, 'Sin puesto') AS puesto, COUNT(*) AS cantidad
       FROM personal p
       LEFT JOIN puestos pu ON pu.id = p.puesto_id
       WHERE ${personalWhereSql}
       GROUP BY puesto
       ORDER BY cantidad DESC`,
      personalParams,
    )) as Array<{ puesto: string; cantidad: number }>

    const empleadosActivos = distribucionPuesto.reduce((acc, row) => acc + Number(row.cantidad), 0)

    // --- Rotación: altas y bajas aprobadas por mes ---
    const rotWhere = ['s.deleted_at IS NULL', "s.estado = 'Aprobada'", "s.tipo IN ('Altas', 'Bajas')"]
    const rotParams: unknown[] = []
    if (sucursalId) {
      rotWhere.push('s.sucursal_id = ?')
      rotParams.push(sucursalId)
    }
    if (desde) {
      rotWhere.push('COALESCE(s.fecha_resolucion, s.fecha_solicitud) >= ?')
      rotParams.push(desde)
    }
    if (hasta) {
      rotWhere.push('COALESCE(s.fecha_resolucion, s.fecha_solicitud) <= ?')
      rotParams.push(hasta)
    }

    const rotacion = (await query(
      `SELECT DATE_FORMAT(COALESCE(s.fecha_resolucion, s.fecha_solicitud), '%Y-%m') AS periodo,
              SUM(s.tipo = 'Altas') AS altas,
              SUM(s.tipo = 'Bajas') AS bajas
       FROM rrhh_solicitudes s
       WHERE ${rotWhere.join(' AND ')}
       GROUP BY periodo
       ORDER BY periodo ASC`,
      rotParams,
    )) as Array<{ periodo: string; altas: number; bajas: number }>

    const totalAltas = rotacion.reduce((acc, r) => acc + Number(r.altas), 0)
    const totalBajas = rotacion.reduce((acc, r) => acc + Number(r.bajas), 0)

    // --- Evolución salarial: promedio de sueldo base por período (escala) ---
    const escWhere = ['e.deleted_at IS NULL']
    const escParams: unknown[] = []
    if (sucursalId) {
      escWhere.push('e.sucursal_id = ?')
      escParams.push(sucursalId)
    }

    const evolucionSalarial = (await query(
      `SELECT CONCAT(e.anio, '-', LPAD(e.mes, 2, '0')) AS periodo,
              ROUND(AVG(e.sueldo_base)) AS sueldoPromedio
       FROM escalas_salariales e
       WHERE ${escWhere.join(' AND ')}
       GROUP BY e.anio, e.mes
       ORDER BY e.anio ASC, e.mes ASC`,
      escParams,
    )) as Array<{ periodo: string; sueldoPromedio: number }>

    // --- Sueldo base promedio por puesto (último período cargado de cada puesto) ---
    const sueldoPorPuesto = (await query(
      `SELECT pu.nombre AS puesto, ROUND(AVG(e.sueldo_base)) AS sueldoPromedio
       FROM escalas_salariales e
       LEFT JOIN puestos pu ON pu.id = e.puesto_id
       WHERE ${escWhere.join(' AND ')}
       GROUP BY pu.nombre
       ORDER BY sueldoPromedio DESC`,
      escParams,
    )) as Array<{ puesto: string; sueldoPromedio: number }>

    return res.json({
      success: true,
      data: {
        resumen: {
          empleadosActivos,
          totalAltas,
          totalBajas,
          rotacionNeta: totalAltas - totalBajas,
        },
        distribucionArea,
        distribucionPuesto,
        rotacion,
        evolucionSalarial,
        sueldoPorPuesto,
      },
    })
  } catch (error) {
    console.error('Error al obtener analítico global de RRHH:', error)
    return res.status(500).json({ success: false, message: 'Error al obtener analítico global de RRHH' })
  }
}
