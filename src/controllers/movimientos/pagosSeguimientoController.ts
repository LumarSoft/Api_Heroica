import { Request, Response } from 'express'
import { query } from '../../config/database'
import { formatearFechaRespuesta } from '../../utils/movimientosHelpers'

interface SolicitudPagoRow {
  id: number
  sucursal_id: number
  user_id: number
  fecha: Date | string
  concepto: string
  comentarios: string | null
  monto: number | string
  moneda: 'ARS' | 'USD' | null
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'completado'
  prioridad: 'baja' | 'media' | 'alta'
  tipo: 'ingreso' | 'egreso' | null
  motivo_rechazo: string | null
  fecha_revision: Date | string | null
  created_at: Date | string
  updated_at: Date | string
  usuario_creador_nombre: string | null
  usuario_revisor_nombre: string | null
  descripcion_nombre: string | null
  proveedor_nombre: string | null
}

/**
 * Devuelve el seguimiento personal del usuario autenticado. El identificador
 * del creador nunca se acepta desde el cliente para evitar consultar pagos de
 * otra persona manipulando la URL.
 */
export const getMisSolicitudesPago = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id
    const sucursalId = Number(req.query.sucursal_id)
    const moneda = String(req.query.moneda ?? 'ARS').toUpperCase()

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }
    if (!Number.isInteger(sucursalId) || sucursalId <= 0) {
      return res.status(400).json({ success: false, message: 'La sucursal es inválida' })
    }
    if (moneda !== 'ARS' && moneda !== 'USD') {
      return res.status(400).json({ success: false, message: 'La moneda es inválida' })
    }

    const monedaClause = moneda === 'ARS' ? `(m.moneda = ? OR m.moneda IS NULL OR m.moneda = '')` : 'm.moneda = ?'
    const result = (await query(
      `SELECT
        m.id, m.sucursal_id, m.user_id, m.fecha, m.concepto, m.comentarios,
        m.monto, m.moneda, m.estado, m.prioridad, m.tipo, m.motivo_rechazo,
        m.fecha_revision, m.created_at, m.updated_at,
        uc.nombre AS usuario_creador_nombre,
        ur.nombre AS usuario_revisor_nombre,
        d.nombre AS descripcion_nombre,
        p.nombre AS proveedor_nombre
      FROM movimientos m
      LEFT JOIN usuarios uc ON m.user_id = uc.id
      LEFT JOIN usuarios ur ON m.usuario_revisor_id = ur.id
      LEFT JOIN descripciones d ON m.descripcion_id = d.id
      LEFT JOIN proveedores p ON m.proveedor_id = p.id
      WHERE m.user_id = ?
        AND m.sucursal_id = ?
        AND m.estado IN ('pendiente', 'aprobado', 'rechazado', 'completado')
        AND (m.estado = 'pendiente' OR m.usuario_revisor_id IS NOT NULL)
        AND (m.tipo = 'egreso' OR m.tipo IS NULL)
        AND m.deleted_at IS NULL
        AND ${monedaClause}
      ORDER BY m.created_at DESC, m.id DESC`,
      [userId, sucursalId, moneda],
    )) as SolicitudPagoRow[]

    const data = result.map(solicitud => ({
      ...solicitud,
      fecha: formatearFechaRespuesta(solicitud.fecha),
      monto: Number(solicitud.monto),
      moneda: solicitud.moneda || 'ARS',
    }))

    return res.json({ success: true, data })
  } catch (error) {
    console.error('Error al obtener el seguimiento personal de pagos:', error)
    return res.status(500).json({ success: false, message: 'Error al obtener tus solicitudes' })
  }
}
