import { Request, Response } from 'express'
import { query } from '../../config/database'
import {
  normalizarFecha,
  formatearFechaRespuesta,
  verificarAccesoSucursal,
  completarContraparte,
} from '../../utils/movimientosHelpers'

// GET /api/movimientos/:sucursalId
export const getMovimientosBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params
    const moneda = (req.query.moneda as string) || 'ARS'

    if (!(await verificarAccesoSucursal(req.user!, sucursalId))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    }

    const result: any = await query(
      `SELECT m.id, m.sucursal_id, m.fecha, m.concepto, m.monto, m.comentarios, m.prioridad,
              m.saldo as tipo_movimiento, m.estado, m.categoria_id, m.subcategoria_id, m.descripcion_id, m.proveedor_id,
              m.tipo, m.es_deuda, m.fecha_original_vencimiento,
              m.moneda, m.tipo_cambio,
              c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
              d.nombre as descripcion_nombre, p.nombre as proveedor_nombre,
              m.created_at, m.updated_at
       FROM movimientos m
       LEFT JOIN categorias c ON m.categoria_id = c.id
       LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
       LEFT JOIN descripciones d ON m.descripcion_id = d.id
       LEFT JOIN proveedores p ON m.proveedor_id = p.id
       WHERE m.sucursal_id = ? AND m.tipo_movimiento = 'efectivo' AND m.moneda = ? AND m.deleted_at IS NULL
         AND NOT (m.estado = 'pendiente' AND m.categoria_id IS NULL)
       ORDER BY m.id DESC`,
      [sucursalId, moneda],
    )

    const resultFormatted = result.map((m: any) => ({
      ...m,
      fecha: formatearFechaRespuesta(m.fecha),
      fecha_original_vencimiento: m.fecha_original_vencimiento
        ? formatearFechaRespuesta(m.fecha_original_vencimiento)
        : null,
    }))

    res.json({
      success: true,
      data: {
        saldo_real: resultFormatted.filter((m: any) => m.tipo_movimiento === 'saldo_real'),
        saldo_necesario: resultFormatted.filter((m: any) => m.tipo_movimiento === 'saldo_necesario'),
      },
    })
  } catch (error) {
    console.error('Error al obtener movimientos:', error)
    res.status(500).json({ success: false, message: 'Error al obtener movimientos' })
  }
}

// POST /api/movimientos/efectivo
export const createMovimientoEfectivo = async (req: Request, res: Response) => {
  try {
    const {
      sucursal_id,
      user_id,
      fecha,
      concepto,
      comentarios,
      monto,
      prioridad,
      estado,
      categoria_id,
      subcategoria_id,
      descripcion_id,
      proveedor_id,
      tipo,
      moneda,
      tipo_cambio,
    } = req.body

    if (!sucursal_id || !user_id || !fecha || monto === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos: sucursal_id, user_id, fecha, monto',
      })
    }

    if (!categoria_id || !subcategoria_id || !descripcion_id) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios: categoría, subcategoría y descripción',
      })
    }

    if (moneda === 'USD' && (!tipo_cambio || Number(tipo_cambio) <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'El tipo de cambio es obligatorio para movimientos en USD',
      })
    }

    const estadoFinal = estado || 'aprobado'
    const saldo = estadoFinal === 'completado' ? 'saldo_real' : 'saldo_necesario'
    const adjustedMonto = tipo === 'egreso' ? -Math.abs(monto) : Math.abs(monto)
    const monedaFinal = moneda || 'ARS'
    const tipoCambioFinal = monedaFinal === 'USD' ? tipo_cambio || null : null

    const result: any = await query(
      `INSERT INTO movimientos
       (sucursal_id, user_id, fecha, concepto, comentarios, monto, saldo, tipo_movimiento, prioridad, estado, categoria_id, subcategoria_id, descripcion_id, proveedor_id, tipo, moneda, tipo_cambio)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'efectivo', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sucursal_id,
        user_id,
        normalizarFecha(fecha),
        concepto ?? '',
        comentarios || null,
        adjustedMonto,
        saldo,
        prioridad || 'media',
        estadoFinal,
        categoria_id || null,
        subcategoria_id || null,
        descripcion_id || null,
        proveedor_id || null,
        tipo || 'ingreso',
        monedaFinal,
        tipoCambioFinal,
      ],
    )

    const createdMovimiento: any = await query('SELECT * FROM movimientos WHERE id = ?', [result.insertId])
    res.status(201).json({ success: true, message: 'Movimiento creado exitosamente', data: createdMovimiento[0] })
  } catch (error) {
    console.error('Error al crear movimiento:', error)
    res.status(500).json({ success: false, message: 'Error al crear movimiento' })
  }
}

// PUT /api/movimientos/:id
export const updateMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const {
      fecha,
      concepto,
      monto,
      comentarios,
      prioridad,
      categoria_id,
      subcategoria_id,
      descripcion_id,
      proveedor_id,
      tipo,
    } = req.body

    if (!fecha || monto === undefined) {
      return res.status(400).json({ success: false, message: 'Fecha y monto son requeridos' })
    }

    const existingResult: any = await query(
      "SELECT id FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo' AND deleted_at IS NULL",
      [id],
    )
    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }

    const adjustedMonto = tipo === 'egreso' ? -Math.abs(monto) : Math.abs(monto)
    await query(
      `UPDATE movimientos
       SET fecha = ?, concepto = ?, monto = ?, comentarios = ?, prioridad = ?, categoria_id = ?, subcategoria_id = ?, descripcion_id = ?, proveedor_id = ?, tipo = ?
       WHERE id = ? AND tipo_movimiento = 'efectivo'`,
      [
        normalizarFecha(fecha),
        concepto ?? '',
        adjustedMonto,
        comentarios || null,
        prioridad || 'media',
        categoria_id || null,
        subcategoria_id || null,
        descripcion_id || null,
        proveedor_id || null,
        tipo || 'ingreso',
        id,
      ],
    )

    const updatedResult: any = await query(
      `SELECT m.*, c.nombre as categoria_nombre, s.nombre as subcategoria_nombre
       FROM movimientos m
       LEFT JOIN categorias c ON m.categoria_id = c.id
       LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
       WHERE m.id = ?`,
      [id],
    )
    res.json({ success: true, message: 'Movimiento actualizado exitosamente', data: updatedResult[0] })
  } catch (error) {
    console.error('Error al actualizar movimiento:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar movimiento' })
  }
}

// DELETE /api/movimientos/:id
export const deleteMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const existingResult: any = await query(
      "SELECT id FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo' AND deleted_at IS NULL",
      [id],
    )
    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }

    await query('UPDATE movimientos SET deleted_at = NOW() WHERE id = ?', [id])
    res.json({ success: true, message: 'Movimiento eliminado exitosamente' })
  } catch (error) {
    console.error('Error al eliminar movimiento:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar movimiento' })
  }
}

// PATCH /api/movimientos/:id/comentario
export const updateComentarioEfectivo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { comentarios } = req.body
    await query(
      "UPDATE movimientos SET comentarios = ? WHERE id = ? AND tipo_movimiento = 'efectivo' AND deleted_at IS NULL",
      [comentarios, id],
    )
    res.json({ success: true, message: 'Comentario actualizado exitosamente' })
  } catch (error) {
    console.error('Error al actualizar comentario:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar comentario' })
  }
}

// PUT /api/movimientos/:id/estado
export const updateEstadoMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { estado } = req.body

    const estadosValidos = ['pendiente', 'aprobado', 'rechazado', 'completado']
    if (!estado || !estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: 'Estado inválido. Debe ser: pendiente, aprobado, rechazado o completado',
      })
    }

    const existingResult: any = await query(
      "SELECT *, saldo as tipo_movimiento FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo' AND deleted_at IS NULL",
      [id],
    )
    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }

    const mov = existingResult[0]

    if (mov.estado !== 'pendiente' && estado === 'pendiente') {
      await query(`UPDATE movimientos SET estado = 'pendiente', saldo = 'saldo_necesario' WHERE id = ?`, [id])
      return res.json({
        success: true,
        message: 'Movimiento marcado como pendiente exitosamente',
        data: { ...mov, estado: 'pendiente' },
      })
    }

    await query('UPDATE movimientos SET estado = ? WHERE id = ?', [estado, id])

    if (estado === 'completado' && mov.es_deuda && mov.movimiento_contraparte_id) {
      await completarContraparte(mov.movimiento_contraparte_id)
    }

    const updatedResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    res.json({ success: true, message: 'Estado actualizado exitosamente', data: updatedResult[0] })
  } catch (error) {
    console.error('Error al actualizar estado:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar estado' })
  }
}

// PUT /api/movimientos/efectivo/:id/mover-a-real
export const moverAReal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const movResult: any = await query(
      "SELECT *, saldo as tipo_movimiento FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo' AND deleted_at IS NULL",
      [id],
    )
    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }
    if (movResult[0].tipo_movimiento !== 'saldo_necesario') {
      return res.status(400).json({ success: false, message: 'El movimiento no está en saldo necesario' })
    }

    const mov = movResult[0]
    await query(`UPDATE movimientos SET saldo = 'saldo_real', estado = 'completado' WHERE id = ?`, [id])

    if (mov.es_deuda && mov.movimiento_contraparte_id) {
      await completarContraparte(mov.movimiento_contraparte_id)
    }

    const updatedResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    res.json({ success: true, message: 'Movimiento movido a saldo real exitosamente', data: updatedResult[0] })
  } catch (error) {
    console.error('Error al mover movimiento:', error)
    res.status(500).json({ success: false, message: 'Error al mover movimiento' })
  }
}

// PUT /api/movimientos/:id/deuda
export const toggleDeudaEfectivo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { es_deuda, fecha_original_vencimiento } = req.body

    if (es_deuda === undefined || (es_deuda !== 0 && es_deuda !== 1)) {
      return res.status(400).json({ success: false, message: 'es_deuda debe ser 0 o 1' })
    }

    const movResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo' AND deleted_at IS NULL",
      [id],
    )
    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }

    const mov = movResult[0]

    if (es_deuda === 1) {
      await query(
        `UPDATE movimientos SET es_deuda = 1, fecha_original_vencimiento = ? WHERE id = ? AND tipo_movimiento = 'efectivo'`,
        [fecha_original_vencimiento ? normalizarFecha(fecha_original_vencimiento) : mov.fecha, id],
      )
    } else {
      await query(`UPDATE movimientos SET estado = 'completado' WHERE id = ? AND tipo_movimiento = 'efectivo'`, [id])

      if (mov.movimiento_contraparte_id) {
        const contraparteResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [
          mov.movimiento_contraparte_id,
        ])
        if (Array.isArray(contraparteResult) && contraparteResult.length > 0) {
          await completarContraparte(mov.movimiento_contraparte_id)
        }
      }

      const fechaOriginal = mov.fecha_original_vencimiento || mov.fecha
      let nuevaDescripcion = mov.comentarios || ''
      if (fechaOriginal) {
        const partes = fechaOriginal.toString().split('T')[0].split('-')
        const fechaFormateada = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : fechaOriginal
        const nota = `[Pago de deuda original del: ${fechaFormateada}]`
        nuevaDescripcion = nuevaDescripcion ? `${nuevaDescripcion} ${nota}` : nota
      }

      const fechaPago = new Date().toISOString().slice(0, 19).replace('T', ' ')
      const adjustedMonto = -Math.abs(mov.monto)

      await query(
        `INSERT INTO movimientos
         (sucursal_id, user_id, fecha, concepto, comprobante, comentarios, monto, tipo_movimiento, saldo, prioridad,
          numero_cheque, banco, cuenta, cbu, tipo_operacion, estado, categoria_id, subcategoria_id, descripcion_id, proveedor_id, banco_id, medio_pago_id, tipo,
          es_deuda, fecha_original_vencimiento, moneda, tipo_cambio)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'efectivo', ?, ?, ?, ?, ?, ?, ?, 'completado', ?, ?, ?, ?, ?, ?, 'egreso', 0, NULL, ?, ?)`,
        [
          mov.sucursal_id,
          mov.user_id,
          fechaPago,
          mov.concepto,
          mov.comprobante,
          nuevaDescripcion,
          adjustedMonto,
          mov.saldo,
          mov.prioridad,
          mov.numero_cheque,
          mov.banco,
          mov.cuenta,
          mov.cbu,
          mov.tipo_operacion,
          mov.categoria_id,
          mov.subcategoria_id,
          mov.descripcion_id,
          mov.proveedor_id,
          mov.banco_id,
          mov.medio_pago_id,
          mov.moneda || 'ARS',
          mov.moneda === 'USD' ? mov.tipo_cambio || null : null,
        ],
      )
    }

    const updatedResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    res.json({
      success: true,
      message: es_deuda === 1 ? 'Deuda activada exitosamente' : 'Deuda desactivada exitosamente',
      data: updatedResult[0],
    })
  } catch (error) {
    console.error('Error al actualizar deuda (efectivo):', error)
    res.status(500).json({ success: false, message: 'Error al actualizar estado de deuda' })
  }
}

// GET /api/movimientos/efectivo/:sucursalId/totales
export const getTotalesEfectivo = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params
    const moneda = (req.query.moneda as string) || 'ARS'

    if (!(await verificarAccesoSucursal(req.user!, sucursalId))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    }

    const result: any = await query(
      `SELECT
        SUM(CASE WHEN estado = 'completado' THEN monto ELSE 0 END) as total_real,
        SUM(CASE WHEN estado = 'aprobado' AND (es_deuda = 0 OR es_deuda IS NULL) THEN monto ELSE 0 END) as total_necesario,
        MAX(updated_at) as ultima_actualizacion
       FROM movimientos
       WHERE sucursal_id = ? AND tipo_movimiento = 'efectivo' AND moneda = ? AND deleted_at IS NULL`,
      [sucursalId, moneda],
    )

    res.json({
      success: true,
      data: {
        total_real: result[0]?.total_real || 0,
        total_necesario: result[0]?.total_necesario || 0,
        ultima_actualizacion: result[0]?.ultima_actualizacion || null,
      },
    })
  } catch (error) {
    console.error('Error al obtener totales:', error)
    res.status(500).json({ success: false, message: 'Error al obtener totales' })
  }
}
