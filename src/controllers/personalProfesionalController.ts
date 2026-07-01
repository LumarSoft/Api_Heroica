import { Request, Response } from 'express'
import { query } from '../config/database'

// GET /api/personal/:id/profesional
export const getProfesional = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const personalId = Number(id)

    const personalResult: any = await query(
      `SELECT id, puesto_id, sucursal_id, fecha_incorporacion, periodo_prueba, periodo_prueba_dias FROM personal WHERE id = ? AND deleted_at IS NULL`,
      [personalId],
    )
    if (!Array.isArray(personalResult) || personalResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }
    const personal = personalResult[0]

    // Período de prueba — 6 meses (180 días) por defecto
    const fechaInc = new Date(personal.fecha_incorporacion)
    const hoy = new Date()
    const diasTotales = Number(personal.periodo_prueba_dias ?? 180)
    const diasTranscurridos = Math.floor((hoy.getTime() - fechaInc.getTime()) / (1000 * 60 * 60 * 24))
    const diasRestantes = Math.max(0, diasTotales - diasTranscurridos)
    const enPeriodo = diasTranscurridos < diasTotales
    const porcentaje = Math.min(100, Math.round((diasTranscurridos / diasTotales) * 100))
    const fechaFin = new Date(fechaInc)
    fechaFin.setDate(fechaFin.getDate() + diasTotales)

    const periodoPrueba = {
      en_periodo: enPeriodo,
      dias_transcurridos: diasTranscurridos,
      dias_restantes: enPeriodo ? diasRestantes : 0,
      dias_totales: diasTotales,
      porcentaje,
      fecha_fin: fechaFin.toISOString().split('T')[0],
      alerta: enPeriodo && diasRestantes <= 15,
    }

    // Escala salarial más reciente para este puesto en la misma sucursal
    const escalaResult: any = await query(
      `SELECT es.id, es.puesto_id, pu.nombre AS puesto_nombre, es.sueldo_base, es.mes, es.anio, es.valor_hora
       FROM escalas_salariales es
       LEFT JOIN puestos pu ON pu.id = es.puesto_id
       WHERE es.puesto_id = ? AND es.sucursal_id = ? AND es.deleted_at IS NULL
       ORDER BY es.anio DESC, es.mes DESC
       LIMIT 1`,
      [personal.puesto_id, personal.sucursal_id],
    )
    const escalaActual = Array.isArray(escalaResult) && escalaResult.length > 0 ? escalaResult[0] : null

    // Solicitudes aprobadas relevantes
    const solicitudesResult: any = await query(
      `SELECT s.id, s.tipo, s.detalles, s.estado, s.fecha_solicitud, s.created_at,
              u.nombre AS creador_nombre
       FROM rrhh_solicitudes s
       LEFT JOIN usuarios u ON u.id = s.usuario_id
       WHERE COALESCE(s.personal_creado_id, s.personal_id) = ?
         AND s.estado = 'Aprobada'
         AND s.tipo IN ('Apercibimientos','Adelantos','Incentivos y premios','Novedades de sueldo','Suspensiones','Descuentos','Horas extras')
         AND s.deleted_at IS NULL
       ORDER BY s.fecha_solicitud DESC`,
      [personalId],
    )

    const solicitudes = Array.isArray(solicitudesResult)
      ? solicitudesResult.map((s: any) => ({
          ...s,
          detalles: typeof s.detalles === 'string' ? JSON.parse(s.detalles) : (s.detalles ?? {}),
        }))
      : []

    res.json({
      success: true,
      data: {
        periodo_prueba: periodoPrueba,
        escala_actual: escalaActual,
        apercibimientos: solicitudes.filter((s: any) => s.tipo === 'Apercibimientos'),
        adelantos: solicitudes.filter((s: any) => s.tipo === 'Adelantos'),
        incentivos_premios: solicitudes.filter((s: any) => s.tipo === 'Incentivos y premios'),
        novedades_sueldo: solicitudes.filter((s: any) => s.tipo === 'Novedades de sueldo'),
        suspensiones: solicitudes.filter((s: any) => s.tipo === 'Suspensiones'),
        descuentos: solicitudes.filter((s: any) => s.tipo === 'Descuentos'),
        horas_extras: solicitudes.filter((s: any) => s.tipo === 'Horas extras'),
      },
    })
  } catch (error) {
    console.error('Error al obtener datos profesionales:', error)
    res.status(500).json({ success: false, message: 'Error al obtener datos profesionales' })
  }
}

// GET /api/personal/:id/analitico
export const getAnalitico = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const personalId = Number(id)

    // Puesto del colaborador
    const personalResult: any = await query(
      `SELECT puesto_id, sucursal_id FROM personal WHERE id = ? AND deleted_at IS NULL`,
      [personalId],
    )
    if (!Array.isArray(personalResult) || personalResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }
    const { puesto_id, sucursal_id } = personalResult[0]

    // Escalas salariales históricas del puesto en la misma sucursal (últimos 24 meses)
    const escalaRows: any = await query(
      `SELECT sueldo_base, valor_hora, mes, anio
       FROM (
         SELECT es.sueldo_base, es.valor_hora, es.mes, es.anio
         FROM escalas_salariales es
         WHERE es.puesto_id = ? AND es.sucursal_id = ? AND es.deleted_at IS NULL
         ORDER BY es.anio DESC, es.mes DESC
         LIMIT 24
       ) AS sub
       ORDER BY anio ASC, mes ASC`,
      [puesto_id, sucursal_id],
    )

    // Solicitudes aprobadas relevantes para analíticos
    const solicitudesRows: any = await query(
      `SELECT s.tipo, s.fecha_solicitud, s.detalles
       FROM rrhh_solicitudes s
       WHERE COALESCE(s.personal_creado_id, s.personal_id) = ?
         AND s.estado = 'Aprobada'
         AND s.tipo IN ('Apercibimientos', 'Incentivos y premios', 'Horas extras')
         AND s.deleted_at IS NULL
       ORDER BY s.fecha_solicitud ASC`,
      [personalId],
    )

    const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

    // ── Sueldos ────────────────────────────────────────────────────────────────
    const sueldos = (Array.isArray(escalaRows) ? escalaRows : []).map((row: any) => ({
      periodo: `${MESES_CORTOS[(Number(row.mes) - 1) % 12]} ${row.anio}`,
      sueldo_base: Number(row.sueldo_base),
      valor_hora: row.valor_hora != null ? Number(row.valor_hora) : null,
    }))

    // ── Helpers de agrupación ──────────────────────────────────────────────────
    const parseDet = (raw: unknown): Record<string, unknown> => {
      if (!raw) return {}
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw)
        } catch {
          return {}
        }
      }
      if (typeof raw === 'object') return raw as Record<string, unknown>
      return {}
    }

    const periodoKey = (fecha: string) => {
      const d = new Date(fecha)
      return `${MESES_CORTOS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
    }

    // ── Apercibimientos por mes ────────────────────────────────────────────────
    const apercibimientosMap: Record<string, { leve: number; moderada: number; grave: number }> = {}
    // ── Incentivos por mes ────────────────────────────────────────────────────
    const incentivosMap: Record<string, { monto: number; cantidad: number }> = {}
    // ── Horas extras por mes ──────────────────────────────────────────────────
    const horasExtrasMap: Record<string, { horas: number }> = {}

    for (const row of Array.isArray(solicitudesRows) ? solicitudesRows : []) {
      const periodo = periodoKey(row.fecha_solicitud)
      const det = parseDet(row.detalles)

      if (row.tipo === 'Apercibimientos') {
        if (!apercibimientosMap[periodo]) apercibimientosMap[periodo] = { leve: 0, moderada: 0, grave: 0 }
        const sev = String(det.severidad ?? 'Leve').toLowerCase()
        if (sev === 'grave') apercibimientosMap[periodo].grave++
        else if (sev === 'moderada') apercibimientosMap[periodo].moderada++
        else apercibimientosMap[periodo].leve++
      }

      if (row.tipo === 'Incentivos y premios') {
        if (!incentivosMap[periodo]) incentivosMap[periodo] = { monto: 0, cantidad: 0 }
        const monto = parseFloat(String(det.monto_calculado ?? det.monto ?? 0))
        incentivosMap[periodo].monto += isNaN(monto) ? 0 : monto
        incentivosMap[periodo].cantidad++
      }

      if (row.tipo === 'Horas extras') {
        if (!horasExtrasMap[periodo]) horasExtrasMap[periodo] = { horas: 0 }
        const horas = parseFloat(String(det.cantidad_horas ?? 0))
        horasExtrasMap[periodo].horas += isNaN(horas) ? 0 : horas
      }
    }

    const toSortedArray = <T extends object>(map: Record<string, T>) =>
      Object.entries(map).map(([periodo, vals]) => ({ periodo, ...vals }))

    const apercibimientos = toSortedArray(apercibimientosMap).map(r => ({
      ...r,
      total: (r as any).leve + (r as any).moderada + (r as any).grave,
    }))
    const incentivos = toSortedArray(incentivosMap)
    const horasExtras = toSortedArray(horasExtrasMap)

    // ── Resumen ───────────────────────────────────────────────────────────────
    const totalApercibimientos = apercibimientos.reduce((s, r) => s + (r as any).total, 0)
    const totalIncentivosMonto = incentivos.reduce((s, r) => s + (r as any).monto, 0)
    const totalHorasExtras = horasExtras.reduce((s, r) => s + (r as any).horas, 0)
    let variacionSueldoPct: number | null = null
    if (sueldos.length >= 2) {
      const primero = sueldos[0].sueldo_base
      const ultimo = sueldos[sueldos.length - 1].sueldo_base
      variacionSueldoPct = primero > 0 ? Math.round(((ultimo - primero) / primero) * 100) : null
    }

    res.json({
      success: true,
      data: {
        sueldos,
        apercibimientos,
        incentivos,
        horas_extras: horasExtras,
        resumen: {
          total_apercibimientos: totalApercibimientos,
          total_incentivos_monto: totalIncentivosMonto,
          total_horas_extras: totalHorasExtras,
          variacion_sueldo_pct: variacionSueldoPct,
        },
      },
    })
  } catch (error) {
    console.error('Error al obtener datos analíticos:', error)
    res.status(500).json({ success: false, message: 'Error al obtener datos analíticos' })
  }
}

// GET /api/personal/:id/notas
export const getNotas = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result: any = await query(
      `SELECT id, contenido, usuario_id, usuario_nombre, created_at
       FROM personal_notas
       WHERE personal_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [id],
    )
    res.json({ success: true, data: Array.isArray(result) ? result : [] })
  } catch (error) {
    console.error('Error al obtener notas:', error)
    res.status(500).json({ success: false, message: 'Error al obtener notas' })
  }
}

// POST /api/personal/:id/notas
export const createNota = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { contenido } = req.body
    const user = (req as any).user

    if (!contenido?.trim()) {
      return res.status(400).json({ success: false, message: 'El contenido es requerido' })
    }

    let nombreUsuario: string = user.nombre ?? ''
    if (!nombreUsuario) {
      const row: any = await query(`SELECT nombre FROM usuarios WHERE id = ? LIMIT 1`, [user.id])
      nombreUsuario = Array.isArray(row) && row.length > 0 ? String(row[0].nombre) : 'Sistema'
    }

    const result: any = await query(
      `INSERT INTO personal_notas (personal_id, contenido, usuario_id, usuario_nombre) VALUES (?, ?, ?, ?)`,
      [id, contenido.trim(), user.id, nombreUsuario],
    )

    const notaResult: any = await query(
      `SELECT id, contenido, usuario_id, usuario_nombre, created_at FROM personal_notas WHERE id = ?`,
      [result.insertId],
    )

    res.status(201).json({ success: true, data: Array.isArray(notaResult) ? notaResult[0] : notaResult })
  } catch (error) {
    console.error('Error al crear nota:', error)
    res.status(500).json({ success: false, message: 'Error al crear nota' })
  }
}

// DELETE /api/personal/:id/notas/:notaId
export const deleteNota = async (req: Request, res: Response) => {
  try {
    const { notaId } = req.params
    const result: any = await query(
      `UPDATE personal_notas SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [notaId],
    )
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Nota no encontrada' })
    }
    res.json({ success: true, message: 'Nota eliminada' })
  } catch (error) {
    console.error('Error al eliminar nota:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar nota' })
  }
}
