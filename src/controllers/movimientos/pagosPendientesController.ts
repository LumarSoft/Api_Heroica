import { Request, Response } from 'express'
import { query } from '../../config/database'
import { normalizarFecha, formatearFechaRespuesta } from '../../utils/movimientosHelpers'
import { sendPagoAprobadoEmail, sendPagoRechazadoEmail, sendNuevoPagoPendienteEmail } from '../../services/emailService'

const formatearPagos = (result: any[]) =>
  result.map((m: any) => ({
    ...m,
    fecha: formatearFechaRespuesta(m.fecha),
    fecha_original_vencimiento: m.fecha_original_vencimiento
      ? formatearFechaRespuesta(m.fecha_original_vencimiento)
      : null,
    fecha_revision: m.fecha_revision ? formatearFechaRespuesta(m.fecha_revision) : null,
  }))

const PAGOS_SELECT = `
  SELECT
    pp.*,
    pp.tipo,
    uc.nombre as usuario_creador_nombre,
    ur.nombre as usuario_revisor_nombre,
    d.nombre as descripcion_nombre,
    p.nombre as proveedor_nombre
  FROM movimientos pp
  LEFT JOIN usuarios uc ON pp.user_id = uc.id
  LEFT JOIN usuarios ur ON pp.usuario_revisor_id = ur.id
  LEFT JOIN descripciones d ON pp.descripcion_id = d.id
  LEFT JOIN proveedores p ON pp.proveedor_id = p.id
`

/** Fila de moneda: ARS incluye registros legacy sin moneda (NULL / vacío). */
const sqlMonedaClause = (alias: string, moneda: string) => {
  if (moneda === 'ARS') {
    return ` AND (${alias}.moneda = ? OR ${alias}.moneda IS NULL OR ${alias}.moneda = '')`
  }
  return ` AND ${alias}.moneda = ?`
}

// GET /api/pagos-pendientes/all
export const getAllPagosPendientes = async (req: Request, res: Response) => {
  try {
    const { moneda } = req.query
    const params: any[] = []

    let sql =
      PAGOS_SELECT +
      `WHERE pp.estado = 'pendiente' AND (pp.tipo = 'egreso' OR pp.tipo IS NULL) AND pp.deleted_at IS NULL`

    if (moneda) {
      const m = String(moneda).toUpperCase()
      sql += sqlMonedaClause('pp', m)
      params.push(m)
    }
    sql += ' ORDER BY pp.fecha DESC'

    const result: any = await query(sql, params)
    res.json({ success: true, data: formatearPagos(result) })
  } catch (error) {
    console.error('Error al obtener todos los pagos pendientes:', error)
    res.status(500).json({ success: false, message: 'Error al obtener todos los pagos pendientes' })
  }
}

// GET /api/pagos-pendientes/:sucursalId
export const getPagosPendientesBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params
    const { moneda } = req.query
    const params: any[] = [sucursalId]

    let sql =
      PAGOS_SELECT +
      `WHERE pp.sucursal_id = ? AND pp.estado = 'pendiente' AND (pp.tipo = 'egreso' OR pp.tipo IS NULL) AND pp.deleted_at IS NULL`

    if (moneda) {
      const m = String(moneda).toUpperCase()
      sql += sqlMonedaClause('pp', m)
      params.push(m)
    }
    sql += ' ORDER BY pp.fecha DESC'

    const result: any = await query(sql, params)
    res.json({ success: true, data: formatearPagos(result) })
  } catch (error) {
    console.error('Error al obtener pagos pendientes:', error)
    res.status(500).json({ success: false, message: 'Error al obtener pagos pendientes' })
  }
}

// POST /api/pagos-pendientes
export const createPagoPendiente = async (req: Request, res: Response) => {
  try {
    const {
      sucursal_id,
      user_id,
      fecha,
      concepto,
      comentarios,
      monto,
      tipo_movimiento,
      prioridad,
      tipo,
      descripcion_id,
      proveedor_id,
      moneda: bodyMoneda,
      tipo_cambio,
    } = req.body

    if (!sucursal_id || !user_id || !fecha || monto === undefined || !tipo_movimiento) {
      return res.status(400).json({ success: false, message: 'Faltan campos requeridos' })
    }

    const destinoCaja = tipo_movimiento === 'banco' ? 'banco' : 'efectivo'
    const adjustedMonto = tipo === 'egreso' ? -Math.abs(monto) : Math.abs(monto)
    const monedaFinal =
      bodyMoneda != null && String(bodyMoneda).trim() !== '' ? String(bodyMoneda).toUpperCase() : 'ARS'
    const tipoCambioFinal = monedaFinal === 'USD' ? tipo_cambio || null : null

    const result: any = await query(
      `INSERT INTO movimientos
       (sucursal_id, user_id, fecha, concepto, comentarios, monto, tipo_movimiento, saldo, prioridad, estado, tipo, descripcion_id, proveedor_id, moneda, tipo_cambio)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'saldo_necesario', ?, 'pendiente', ?, ?, ?, ?, ?)`,
      [
        sucursal_id,
        user_id,
        normalizarFecha(fecha),
        concepto ?? '',
        comentarios || null,
        adjustedMonto,
        destinoCaja,
        prioridad || 'media',
        tipo || 'egreso',
        descripcion_id || null,
        proveedor_id || null,
        monedaFinal,
        tipoCambioFinal,
      ],
    )

    const createdPago: any = await query('SELECT * FROM movimientos WHERE id = ?', [result.insertId])

    const creadorResult: any = await query('SELECT nombre FROM usuarios WHERE id = ?', [user_id])
    const creador = (creadorResult as any[])[0]

    await sendNuevoPagoPendienteEmail({
      creadorNombre: creador?.nombre ?? 'Usuario',
      concepto: concepto ?? '',
      monto: String(Math.abs(adjustedMonto)),
      moneda: monedaFinal,
      fecha: normalizarFecha(fecha),
      prioridad: prioridad || 'media',
    })

    res.status(201).json({ success: true, message: 'Pago pendiente creado exitosamente', data: createdPago[0] })
  } catch (error) {
    console.error('Error al crear pago pendiente:', error)
    res.status(500).json({ success: false, message: 'Error al crear pago pendiente' })
  }
}

// PUT /api/pagos-pendientes/:id/aprobar
export const aprobarPagoPendiente = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const {
      usuario_revisor_id,
      tipo_caja,
      fecha,
      concepto,
      comentarios,
      monto,
      prioridad,
      categoria_id,
      subcategoria_id,
      descripcion_id,
      proveedor_id,
      banco_id,
      medio_pago_id,
    } = req.body

    if (!usuario_revisor_id) {
      return res.status(400).json({ success: false, message: 'ID de usuario revisor es requerido' })
    }

    if (!categoria_id || !subcategoria_id || !descripcion_id) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios: categoría, subcategoría y descripción',
      })
    }

    const pagoResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    if (!Array.isArray(pagoResult) || pagoResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Pago pendiente no encontrado' })
    }

    const pago = pagoResult[0]
    if (pago.estado !== 'pendiente') {
      return res.status(400).json({ success: false, message: 'El pago ya fue procesado' })
    }

    let newTipoMovimiento = pago.tipo_movimiento
    if (tipo_caja) newTipoMovimiento = tipo_caja === 'efectivo' ? 'efectivo' : 'banco'

    const bancoFinal = banco_id || pago.banco_id
    const medioPagoFinal = medio_pago_id || pago.medio_pago_id
    if (newTipoMovimiento === 'banco' && (!bancoFinal || !medioPagoFinal)) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios: banco y medio de pago',
      })
    }

    let nuevaDescripcion = comentarios || pago.comentarios || ''
    if (fecha && pago.fecha) {
      const fechaOriginal = new Date(pago.fecha).toISOString().split('T')[0]
      if (fechaOriginal !== fecha) {
        const [y1, m1, d1] = fechaOriginal.split('-')
        const [y2, m2, d2] = fecha.split('-')
        const nota = `\n[Nota del sistema: El administrador modificó la fecha de pago de ${d1}/${m1}/${y1} a ${d2}/${m2}/${y2}]`
        nuevaDescripcion = nuevaDescripcion ? `${nuevaDescripcion}${nota}` : nota
      }
    }
    const adjustedMonto =
      monto !== undefined ? (pago.tipo === 'egreso' ? -Math.abs(monto) : Math.abs(monto)) : pago.monto

    await query(
      `UPDATE movimientos
       SET estado = 'aprobado', usuario_revisor_id = ?, tipo_movimiento = ?, saldo = 'saldo_necesario',
           fecha = COALESCE(?, fecha), concepto = COALESCE(?, concepto), comentarios = ?, monto = ?, 
           prioridad = COALESCE(?, prioridad), categoria_id = ?, subcategoria_id = ?, 
           descripcion_id = ?, proveedor_id = ?, banco_id = ?, medio_pago_id = ?
       WHERE id = ?`,
      [
        usuario_revisor_id,
        newTipoMovimiento,
        fecha ? normalizarFecha(fecha) : null,
        concepto || null,
        nuevaDescripcion,
        adjustedMonto,
        prioridad || null,
        categoria_id || null,
        subcategoria_id || null,
        descripcion_id || null,
        proveedor_id || null,
        bancoFinal || null,
        medioPagoFinal || null,
        id,
      ],
    )

    const updatedPago: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])

    const creadorResult: any = await query(
      'SELECT nombre, email FROM usuarios WHERE id = ?',
      [pago.user_id],
    )
    const revisorResult: any = await query('SELECT nombre FROM usuarios WHERE id = ?', [usuario_revisor_id])
    const creador = (creadorResult as any[])[0]
    const revisor = (revisorResult as any[])[0]

    if (creador?.email) {
      sendPagoAprobadoEmail({
        destinatario: creador.email,
        destinatarioNombre: creador.nombre,
        revisorNombre: revisor?.nombre ?? 'Administrador',
        concepto: updatedPago[0]?.concepto ?? '',
        monto: String(Math.abs(updatedPago[0]?.monto ?? 0)),
        moneda: updatedPago[0]?.moneda ?? 'ARS',
        fecha: formatearFechaRespuesta(updatedPago[0]?.fecha) ?? '',
      })
    }

    res.json({ success: true, message: 'Pago aprobado y programado exitosamente', data: updatedPago[0] })
  } catch (error) {
    console.error('Error al aprobar pago:', error)
    res.status(500).json({ success: false, message: 'Error al aprobar pago' })
  }
}

// PUT /api/pagos-pendientes/:id/rechazar
export const rechazarPagoPendiente = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { usuario_revisor_id, motivo_rechazo } = req.body

    if (!usuario_revisor_id || !motivo_rechazo) {
      return res.status(400).json({ success: false, message: 'Usuario revisor y motivo de rechazo son requeridos' })
    }

    const pagoResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    if (!Array.isArray(pagoResult) || pagoResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Pago pendiente no encontrado' })
    }
    if (pagoResult[0].estado !== 'pendiente') {
      return res.status(400).json({ success: false, message: 'El pago ya fue procesado' })
    }

    await query(
      `UPDATE movimientos SET estado = 'rechazado', usuario_revisor_id = ?, motivo_rechazo = ? WHERE id = ?`,
      [usuario_revisor_id, motivo_rechazo, id],
    )

    const updatedPago: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])

    const creadorResult: any = await query(
      'SELECT nombre, email FROM usuarios WHERE id = ?',
      [pagoResult[0].user_id],
    )
    const revisorResult: any = await query('SELECT nombre FROM usuarios WHERE id = ?', [usuario_revisor_id])
    const creador = (creadorResult as any[])[0]
    const revisor = (revisorResult as any[])[0]

    if (creador?.email) {
      sendPagoRechazadoEmail({
        destinatario: creador.email,
        destinatarioNombre: creador.nombre,
        revisorNombre: revisor?.nombre ?? 'Administrador',
        concepto: pagoResult[0]?.concepto ?? '',
        monto: String(Math.abs(pagoResult[0]?.monto ?? 0)),
        moneda: pagoResult[0]?.moneda ?? 'ARS',
        fecha: formatearFechaRespuesta(pagoResult[0]?.fecha) ?? '',
        motivoRechazo: motivo_rechazo,
      })
    }

    res.json({ success: true, message: 'Pago rechazado exitosamente', data: updatedPago[0] })
  } catch (error) {
    console.error('Error al rechazar pago:', error)
    res.status(500).json({ success: false, message: 'Error al rechazar pago' })
  }
}

// DELETE /api/pagos-pendientes/:id
export const deletePagoPendiente = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const pagoResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    if (!Array.isArray(pagoResult) || pagoResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Pago pendiente no encontrado' })
    }
    if (pagoResult[0].estado !== 'pendiente') {
      return res.status(400).json({ success: false, message: 'Solo se pueden eliminar pagos pendientes' })
    }

    await query('DELETE FROM movimientos WHERE id = ?', [id])
    res.json({ success: true, message: 'Pago pendiente eliminado exitosamente' })
  } catch (error) {
    console.error('Error al eliminar pago pendiente:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar pago pendiente' })
  }
}

// GET /api/pagos-pendientes/historial/:userId
export const getHistorialByUser = async (req: Request, res: Response) => {
  try {
    const paramUserId = Number(req.params.userId)
    const authUserId = req.user?.id
    const { sucursal_id, moneda } = req.query

    if (!Number.isFinite(paramUserId) || !authUserId) {
      return res.status(400).json({ success: false, message: 'Solicitud inválida' })
    }

    const viewerResult: any = await query(
      'SELECT r.nombre as rol FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id WHERE u.id = ?',
      [authUserId],
    )
    const viewerRol = String(viewerResult[0]?.rol || 'empleado')
      .toLowerCase()
      .trim()
    const isAdminOrSuper = viewerRol === 'admin' || viewerRol === 'superadmin'

    if (!isAdminOrSuper) {
      if (paramUserId !== authUserId) {
        return res.status(403).json({ success: false, message: 'No autorizado' })
      }
    }

    let sql = `
      SELECT
        m.*,
        uc.nombre as usuario_creador_nombre,
        ur.nombre as usuario_revisor_nombre
      FROM movimientos m
      LEFT JOIN usuarios uc ON m.user_id = uc.id
      LEFT JOIN usuarios ur ON m.usuario_revisor_id = ur.id
      WHERE m.estado IN ('aprobado', 'rechazado', 'completado')
        AND (m.tipo = 'egreso' OR m.tipo IS NULL)
        AND m.usuario_revisor_id IS NOT NULL
        AND m.deleted_at IS NULL
    `
    const queryParams: any[] = []

    if (!isAdminOrSuper) {
      sql += ' AND m.user_id = ?'
      queryParams.push(authUserId)
    }
    if (sucursal_id) {
      sql += ' AND m.sucursal_id = ?'
      queryParams.push(sucursal_id)
    }
    if (moneda) {
      const m = String(moneda).toUpperCase()
      sql += sqlMonedaClause('m', m)
      queryParams.push(m)
    }
    sql += ' ORDER BY m.id DESC'

    const result: any = await query(sql, queryParams)
    res.json({ success: true, data: formatearPagos(result) })
  } catch (error) {
    console.error('Error al obtener historial de pagos pendientes:', error)
    res.status(500).json({ success: false, message: 'Error al obtener historial' })
  }
}
