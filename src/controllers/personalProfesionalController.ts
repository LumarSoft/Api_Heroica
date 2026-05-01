import { Request, Response } from 'express'
import { query } from '../config/database'

// GET /api/personal/:id/profesional
export const getProfesional = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const personalId = Number(id)

    const personalResult: any = await query(
      `SELECT id, puesto_id, fecha_incorporacion FROM personal WHERE id = ? AND deleted_at IS NULL`,
      [personalId],
    )
    if (!Array.isArray(personalResult) || personalResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }
    const personal = personalResult[0]

    // Período de prueba (90 días — Art. 92 bis LCT)
    const fechaInc = new Date(personal.fecha_incorporacion)
    const hoy = new Date()
    const diasTotales = 90
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

    // Escala salarial más reciente para este puesto
    const escalaResult: any = await query(
      `SELECT es.id, es.puesto_id, pu.nombre AS puesto_nombre, es.sueldo_base, es.mes, es.anio, es.valor_hora
       FROM escalas_salariales es
       LEFT JOIN puestos pu ON pu.id = es.puesto_id
       WHERE es.puesto_id = ? AND es.deleted_at IS NULL
       ORDER BY es.anio DESC, es.mes DESC
       LIMIT 1`,
      [personal.puesto_id],
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

    const result: any = await query(
      `INSERT INTO personal_notas (personal_id, contenido, usuario_id, usuario_nombre) VALUES (?, ?, ?, ?)`,
      [id, contenido.trim(), user.id, user.nombre],
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
