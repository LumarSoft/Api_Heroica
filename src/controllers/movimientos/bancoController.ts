import { Request, Response } from 'express'
import { query } from '../../config/database'
import {
  normalizarFecha,
  formatearFechaRespuesta,
  formatearPeriodoRespuesta,
  esPeriodoValido,
  normalizarPeriodo,
  verificarAccesoSucursal,
  completarContraparte,
  esMovimientoDePrestamo,
  MENSAJE_MOVIMIENTO_PRESTAMO,
} from '../../utils/movimientosHelpers'
import {
  parseSaldo,
  parseFiltros,
  parsePaginacion,
  sqlSaldo,
  sqlFiltros,
  sqlCursor,
  sqlOrderBy,
  construirCursor,
} from '../../utils/movimientosFiltros'

// GET /api/caja-banco/:sucursalId
export const getMovimientosBancoBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params
    const moneda = (req.query.moneda as string) || 'ARS'

    if (!(await verificarAccesoSucursal(req.user!, sucursalId))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    }

    const saldo = parseSaldo(req)
    const filtros = parseFiltros(req)
    const pag = parsePaginacion(req)

    const SELECT = `SELECT m.id, m.sucursal_id, m.fecha, m.periodo, m.origen, m.orden, m.concepto, m.comprobante, m.monto, m.comentarios, m.prioridad,
              m.saldo as tipo_movimiento, m.estado, m.numero_cheque,
              m.cheque_rechazado, m.cheque_rechazado_at, m.cheque_rechazo_motivo, m.banco, m.cuenta, m.cbu,
              m.tipo_operacion, m.tipo, m.categoria_id, m.subcategoria_id, m.descripcion_id, m.proveedor_id, m.banco_id, m.medio_pago_id,
              m.es_deuda, m.fecha_original_vencimiento,
              m.moneda, m.tipo_cambio,
              c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
              d.nombre as descripcion_nombre, p.nombre as proveedor_nombre,
              b.nombre as banco_nombre, mp.nombre as medio_pago_nombre,
              m.created_at, m.updated_at
       FROM movimientos m
       LEFT JOIN categorias c ON m.categoria_id = c.id
       LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
       LEFT JOIN descripciones d ON m.descripcion_id = d.id
       LEFT JOIN proveedores p ON m.proveedor_id = p.id
       LEFT JOIN bancos b ON m.banco_id = b.id
       LEFT JOIN medios_pago mp ON m.medio_pago_id = mp.id
       WHERE m.sucursal_id = ? AND m.tipo_movimiento = 'banco' AND m.moneda = ? AND m.deleted_at IS NULL
         AND (m.estado IS NULL OR m.estado <> 'pendiente')`

    const formatear = (rows: any[]) =>
      rows.map((m: any) => ({
        ...m,
        fecha: formatearFechaRespuesta(m.fecha),
        periodo: formatearPeriodoRespuesta(m.periodo, m.fecha),
        fecha_original_vencimiento: m.fecha_original_vencimiento
          ? formatearFechaRespuesta(m.fecha_original_vencimiento)
          : null,
        cheque_rechazado: Boolean(m.cheque_rechazado),
        cheque_rechazado_at: m.cheque_rechazado_at ? formatearFechaRespuesta(m.cheque_rechazado_at) : null,
      }))

    if (saldo === null) {
      const result: any = await query(`${SELECT} ORDER BY m.id DESC`, [sucursalId, moneda])
      const resultFormatted = formatear(result)
      return res.json({
        success: true,
        data: {
          saldo_real: resultFormatted.filter((m: any) => m.tipo_movimiento === 'saldo_real'),
          saldo_necesario: resultFormatted.filter((m: any) => m.tipo_movimiento === 'saldo_necesario'),
        },
      })
    }

    const f = sqlFiltros('m', filtros)
    const cur = sqlCursor('m', saldo, pag)
    const sql =
      SELECT + ` AND ${sqlSaldo('m', saldo)}` + f.sql + cur.sql + sqlOrderBy('m', saldo) + ` LIMIT ${pag.limit + 1}`

    const rows: any = await query(sql, [sucursalId, moneda, ...f.params, ...cur.params])
    const hasMore = rows.length > pag.limit
    const items = hasMore ? rows.slice(0, pag.limit) : rows

    res.json({
      success: true,
      data: {
        items: formatear(items),
        hasMore,
        nextCursor: hasMore ? construirCursor(items[items.length - 1]) : null,
      },
    })
  } catch (error) {
    console.error('Error al obtener movimientos banco:', error)
    res.status(500).json({ success: false, message: 'Error al obtener movimientos banco' })
  }
}

// POST /api/caja-banco
export const createMovimientoBanco = async (req: Request, res: Response) => {
  try {
    const {
      sucursal_id,
      user_id,
      fecha,
      periodo,
      orden,
      concepto,
      comprobante,
      comentarios,
      monto,
      prioridad,
      estado,
      categoria_id,
      subcategoria_id,
      descripcion_id,
      proveedor_id,
      banco_id,
      medio_pago_id,
      numero_cheque,
      banco,
      cuenta,
      cbu,
      tipo_operacion,
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

    if (!banco_id || !medio_pago_id) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos obligatorios: banco y medio de pago',
      })
    }

    if (moneda === 'USD' && (!tipo_cambio || Number(tipo_cambio) <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'El tipo de cambio es obligatorio para movimientos en USD',
      })
    }

    if (!esPeriodoValido(periodo)) {
      return res.status(400).json({ success: false, message: 'El período debe tener el formato AAAA-MM' })
    }

    const estadoFinal = estado || 'aprobado'
    const saldo = estadoFinal === 'completado' ? 'saldo_real' : 'saldo_necesario'
    const adjustedMonto = tipo === 'egreso' ? -Math.abs(monto) : Math.abs(monto)
    const monedaFinal = moneda || 'ARS'
    const tipoCambioFinal = monedaFinal === 'USD' ? tipo_cambio || null : null

    const result: any = await query(
      `INSERT INTO movimientos
       (sucursal_id, user_id, fecha, periodo, orden, concepto, comprobante, comentarios, monto, tipo_movimiento, saldo, prioridad,
        numero_cheque, banco, cuenta, cbu, tipo_operacion, estado, categoria_id, subcategoria_id, descripcion_id, proveedor_id, banco_id, medio_pago_id, tipo, moneda, tipo_cambio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'banco', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sucursal_id,
        user_id,
        normalizarFecha(fecha),
        normalizarPeriodo(periodo, fecha),
        orden ?? null,
        concepto ?? '',
        comprobante || null,
        comentarios || null,
        adjustedMonto,
        saldo,
        prioridad || 'media',
        numero_cheque || null,
        banco || null,
        cuenta || null,
        cbu || null,
        tipo_operacion || null,
        estadoFinal,
        categoria_id || null,
        subcategoria_id || null,
        descripcion_id || null,
        proveedor_id || null,
        banco_id || null,
        medio_pago_id || null,
        tipo || 'ingreso',
        monedaFinal,
        tipoCambioFinal,
      ],
    )

    const createdMovimiento: any = await query('SELECT * FROM movimientos WHERE id = ?', [result.insertId])
    res.status(201).json({ success: true, message: 'Movimiento creado exitosamente', data: createdMovimiento[0] })
  } catch (error) {
    console.error('Error al crear movimiento banco:', error)
    res.status(500).json({ success: false, message: 'Error al crear movimiento banco' })
  }
}

// PUT /api/caja-banco/:id
export const updateMovimientoBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    if (await esMovimientoDePrestamo([id])) {
      return res.status(409).json({ success: false, message: MENSAJE_MOVIMIENTO_PRESTAMO })
    }
    const {
      fecha,
      periodo,
      concepto,
      comprobante,
      monto,
      comentarios,
      prioridad,
      categoria_id,
      subcategoria_id,
      descripcion_id,
      proveedor_id,
      banco_id,
      medio_pago_id,
      numero_cheque,
      banco,
      cuenta,
      cbu,
      tipo_operacion,
      tipo,
    } = req.body

    if (!fecha || monto === undefined) {
      return res.status(400).json({ success: false, message: 'Fecha y monto son requeridos' })
    }
    if (!esPeriodoValido(periodo)) {
      return res.status(400).json({ success: false, message: 'El período debe tener el formato AAAA-MM' })
    }

    const existingResult: any = await query("SELECT id FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'", [
      id,
    ])
    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }

    const adjustedMonto = tipo === 'egreso' ? -Math.abs(monto) : Math.abs(monto)
    await query(
      `UPDATE movimientos
       SET fecha = ?, periodo = IF(?, ?, periodo), concepto = ?, comprobante = ?, monto = ?, comentarios = ?, prioridad = ?,
           numero_cheque = ?, banco = ?, cuenta = ?, cbu = ?, tipo_operacion = ?, tipo = ?,
           categoria_id = ?, subcategoria_id = ?, descripcion_id = ?, proveedor_id = ?, banco_id = ?, medio_pago_id = ?
       WHERE id = ? AND tipo_movimiento = 'banco'`,
      [
        normalizarFecha(fecha),
        // Si el body no trae período (ej. edición en celda) se conserva el que tenía
        periodo !== undefined ? 1 : 0,
        normalizarPeriodo(periodo, fecha),
        concepto ?? '',
        comprobante || null,
        adjustedMonto,
        comentarios || null,
        prioridad || 'media',
        numero_cheque || null,
        banco || null,
        cuenta || null,
        cbu || null,
        tipo_operacion || null,
        tipo || 'ingreso',
        categoria_id || null,
        subcategoria_id || null,
        descripcion_id || null,
        proveedor_id || null,
        banco_id || null,
        medio_pago_id || null,
        id,
      ],
    )

    const updatedResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    res.json({ success: true, message: 'Movimiento actualizado exitosamente', data: updatedResult[0] })
  } catch (error) {
    console.error('Error al actualizar movimiento banco:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar movimiento banco' })
  }
}

// PATCH /api/caja-banco/:id/cheque-rechazado — Body: { rechazado: boolean, motivo?: string }
// Marca (o desmarca) el cheque / eCheq del movimiento como rechazado. Es solo una etiqueta:
// no cambia estado ni saldo, porque un pago con un eCheq que rebotó sigue pendiente.
export const marcarChequeRechazado = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { rechazado, motivo } = req.body

    if (typeof rechazado !== 'boolean') {
      return res.status(400).json({ success: false, message: 'rechazado debe ser true o false' })
    }

    const movResult: any = await query(
      `SELECT m.id, m.sucursal_id, mp.nombre AS medio_pago_nombre
       FROM movimientos m
       LEFT JOIN medios_pago mp ON m.medio_pago_id = mp.id
       WHERE m.id = ? AND m.tipo_movimiento = 'banco' AND m.deleted_at IS NULL`,
      [id],
    )
    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }
    const mov = movResult[0]

    if (!(await verificarAccesoSucursal(req.user!, mov.sucursal_id))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    }
    if (rechazado && !/cheque|echeq/i.test(mov.medio_pago_nombre ?? '')) {
      return res.status(400).json({
        success: false,
        message: 'Solo se puede marcar como rechazado un movimiento pagado con cheque o eCheq',
      })
    }

    const motivoFinal = rechazado
      ? String(motivo ?? '')
          .trim()
          .slice(0, 255) || null
      : null
    await query(
      `UPDATE movimientos
       SET cheque_rechazado = ?, cheque_rechazado_at = IF(?, NOW(), NULL), cheque_rechazo_motivo = ?
       WHERE id = ?`,
      [rechazado ? 1 : 0, rechazado ? 1 : 0, motivoFinal, id],
    )

    res.json({
      success: true,
      message: rechazado ? 'Cheque marcado como rechazado' : 'Se quitó la marca de rechazado',
      data: { id: Number(id), cheque_rechazado: rechazado, cheque_rechazo_motivo: motivoFinal },
    })
  } catch (error) {
    console.error('Error al marcar cheque rechazado:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar el cheque' })
  }
}

// DELETE /api/caja-banco/:id
export const deleteMovimientoBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    if (await esMovimientoDePrestamo([id])) {
      return res.status(409).json({ success: false, message: MENSAJE_MOVIMIENTO_PRESTAMO })
    }

    const existingResult: any = await query(
      "SELECT id FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco' AND deleted_at IS NULL",
      [id],
    )
    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }

    await query("UPDATE movimientos SET deleted_at = NOW() WHERE id = ? AND tipo_movimiento = 'banco'", [id])
    res.json({ success: true, message: 'Movimiento eliminado exitosamente' })
  } catch (error) {
    console.error('Error al eliminar movimiento banco:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar movimiento banco' })
  }
}

// PATCH /api/caja-banco/:id/comentario
export const updateComentarioBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { comentarios } = req.body
    await query(
      "UPDATE movimientos SET comentarios = ? WHERE id = ? AND tipo_movimiento = 'banco' AND deleted_at IS NULL",
      [comentarios, id],
    )
    res.json({ success: true, message: 'Comentario actualizado exitosamente' })
  } catch (error) {
    console.error('Error al actualizar comentario banco:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar comentario' })
  }
}

// POST /api/caja-banco/transferencia-interna
export const transferenciaInternaBanco = async (req: Request, res: Response) => {
  try {
    const { sucursal_id, user_id, fecha, concepto, comentarios, monto, banco_origen_id, banco_destino_id, moneda } =
      req.body

    if (!sucursal_id || !user_id || !fecha || monto === undefined || !banco_origen_id || !banco_destino_id) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos: sucursal_id, user_id, fecha, monto, banco_origen_id, banco_destino_id',
      })
    }

    if (banco_origen_id === banco_destino_id) {
      return res.status(400).json({ success: false, message: 'El banco origen y destino no pueden ser el mismo' })
    }

    const montoAbs = Math.abs(monto)
    const monedaFinal = moneda || 'ARS'
    const conceptoBase = concepto || 'Transferencia interna entre bancos'
    const comentariosBase = comentarios || null
    const fechaNorm = normalizarFecha(fecha)

    const egreso: any = await query(
      `INSERT INTO movimientos
       (sucursal_id, user_id, fecha, concepto, comentarios, monto, tipo_movimiento, saldo, estado, tipo, banco_id, moneda)
       VALUES (?, ?, ?, ?, ?, ?, 'banco', 'saldo_real', 'completado', 'egreso', ?, ?)`,
      [
        sucursal_id,
        user_id,
        fechaNorm,
        `${conceptoBase} (Egreso)`,
        comentariosBase,
        -montoAbs,
        banco_origen_id,
        monedaFinal,
      ],
    )

    const ingreso: any = await query(
      `INSERT INTO movimientos
       (sucursal_id, user_id, fecha, concepto, comentarios, monto, tipo_movimiento, saldo, estado, tipo, banco_id, moneda)
       VALUES (?, ?, ?, ?, ?, ?, 'banco', 'saldo_real', 'completado', 'ingreso', ?, ?)`,
      [
        sucursal_id,
        user_id,
        fechaNorm,
        `${conceptoBase} (Ingreso)`,
        comentariosBase,
        montoAbs,
        banco_destino_id,
        monedaFinal,
      ],
    )

    res.status(201).json({
      success: true,
      message: 'Transferencia interna realizada exitosamente',
      data: { egreso_id: egreso.insertId, ingreso_id: ingreso.insertId },
    })
  } catch (error) {
    console.error('Error al realizar transferencia interna:', error)
    res.status(500).json({ success: false, message: 'Error al realizar transferencia interna' })
  }
}

// PUT /api/caja-banco/:id/mover-a-real
export const moverARealBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    if (await esMovimientoDePrestamo([id])) {
      return res.status(409).json({ success: false, message: MENSAJE_MOVIMIENTO_PRESTAMO })
    }

    const movResult: any = await query(
      "SELECT *, saldo as tipo_movimiento FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco' AND deleted_at IS NULL",
      [id],
    )
    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }
    if (movResult[0].tipo_movimiento !== 'saldo_necesario') {
      return res.status(400).json({ success: false, message: 'El movimiento no está en saldo necesario' })
    }

    const mov = movResult[0]
    await query(
      `UPDATE movimientos SET saldo = 'saldo_real', estado = 'completado' WHERE id = ? AND tipo_movimiento = 'banco'`,
      [id],
    )

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

// PUT /api/caja-banco/:id/estado
export const updateEstadoMovimientoBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    if (await esMovimientoDePrestamo([id])) {
      return res.status(409).json({ success: false, message: MENSAJE_MOVIMIENTO_PRESTAMO })
    }
    const { estado } = req.body

    const estadosValidos = ['pendiente', 'aprobado', 'rechazado', 'completado']
    if (!estado || !estadosValidos.includes(estado)) {
      return res.status(400).json({ success: false, message: 'Estado inválido' })
    }

    const existingResult: any = await query(
      "SELECT *, saldo as tipo_movimiento FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco' AND deleted_at IS NULL",
      [id],
    )
    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }

    const mov = existingResult[0]

    if (mov.estado !== 'pendiente' && estado === 'pendiente') {
      await query(
        `UPDATE movimientos SET estado = 'pendiente', saldo = 'saldo_necesario' WHERE id = ? AND tipo_movimiento = 'banco'`,
        [id],
      )
      return res.json({
        success: true,
        message: 'Movimiento marcado como pendiente exitosamente',
        data: { ...mov, estado: 'pendiente' },
      })
    }

    // Mantenemos la columna `saldo` sincronizada con el estado: completado → saldo_real,
    // cualquier otro (aprobado/rechazado) → saldo_necesario. Esto permite que arrastrar un
    // movimiento entre "Saldo Real" y "Saldo Necesario" en la UI deje los datos consistentes.
    const nuevoSaldo = estado === 'completado' ? 'saldo_real' : 'saldo_necesario'
    await query("UPDATE movimientos SET estado = ?, saldo = ? WHERE id = ? AND tipo_movimiento = 'banco'", [
      estado,
      nuevoSaldo,
      id,
    ])

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

// PUT /api/caja-banco/:id/deuda
export const toggleDeudaBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    if (await esMovimientoDePrestamo([id])) {
      return res.status(409).json({ success: false, message: MENSAJE_MOVIMIENTO_PRESTAMO })
    }
    const { es_deuda, fecha_original_vencimiento } = req.body

    if (es_deuda === undefined || (es_deuda !== 0 && es_deuda !== 1)) {
      return res.status(400).json({ success: false, message: 'es_deuda debe ser 0 o 1' })
    }

    const movResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco' AND deleted_at IS NULL",
      [id],
    )
    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }

    const mov = movResult[0]

    if (es_deuda === 1) {
      await query(
        `UPDATE movimientos SET es_deuda = 1, fecha_original_vencimiento = ? WHERE id = ? AND tipo_movimiento = 'banco'`,
        [fecha_original_vencimiento ? normalizarFecha(fecha_original_vencimiento) : mov.fecha, id],
      )
    } else {
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
        const partes = (formatearFechaRespuesta(fechaOriginal) ?? '').split('-')
        const fechaFormateada = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : fechaOriginal
        const nota = `[Pago de deuda original del: ${fechaFormateada}]`
        nuevaDescripcion = nuevaDescripcion ? `${nuevaDescripcion} ${nota}` : nota
      }

      // Quitar la deuda = darla por pagada. Antes además se insertaba un egreso de pago,
      // y el gasto quedaba contado dos veces en el saldo real.
      await query(
        `UPDATE movimientos SET estado = 'completado', saldo = 'saldo_real', comentarios = ?
         WHERE id = ? AND tipo_movimiento = 'banco'`,
        [nuevaDescripcion || null, id],
      )
    }

    const updatedResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    res.json({
      success: true,
      message: es_deuda === 1 ? 'Deuda activada exitosamente' : 'Deuda desactivada exitosamente',
      data: updatedResult[0],
    })
  } catch (error) {
    console.error('Error al actualizar deuda (banco):', error)
    res.status(500).json({ success: false, message: 'Error al actualizar estado de deuda' })
  }
}

// GET /api/caja-banco/:sucursalId/totales
export const getTotalesBanco = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params
    const moneda = (req.query.moneda as string) || 'ARS'

    if (!(await verificarAccesoSucursal(req.user!, sucursalId))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    }

    const filtros = parseFiltros(req)
    const f = sqlFiltros('m', filtros)

    const BASE = `FROM movimientos m
       LEFT JOIN descripciones d ON m.descripcion_id = d.id
       LEFT JOIN medios_pago mp ON m.medio_pago_id = mp.id
       LEFT JOIN bancos b ON m.banco_id = b.id
       WHERE m.sucursal_id = ? AND m.tipo_movimiento = 'banco' AND m.moneda = ? AND m.deleted_at IS NULL`

    // Las solicitudes sin aprobar (estado = 'pendiente') NO integran el saldo necesario:
    // viven en Pagos Pendientes hasta que el superadmin las aprueba.
    const SUMAS = `SUM(CASE WHEN m.estado = 'completado' THEN m.monto ELSE 0 END) as total_real,
        SUM(CASE WHEN m.estado = 'aprobado' AND (m.es_deuda = 0 OR m.es_deuda IS NULL) THEN m.monto ELSE 0 END) as total_necesario`

    const result: any = await query(`SELECT ${SUMAS}, MAX(m.updated_at) as ultima_actualizacion ${BASE}${f.sql}`, [
      sucursalId,
      moneda,
      ...f.params,
    ])

    const parcialesResult: any = await query(
      `SELECT b.id as banco_id, b.nombre as banco_nombre, ${SUMAS}
       ${BASE}${f.sql}
       GROUP BY b.id, b.nombre`,
      [sucursalId, moneda, ...f.params],
    )

    res.json({
      success: true,
      data: {
        total_real: result[0]?.total_real || 0,
        total_necesario: result[0]?.total_necesario || 0,
        ultima_actualizacion: result[0]?.ultima_actualizacion || null,
        parciales: parcialesResult || [],
      },
    })
  } catch (error) {
    console.error('Error al obtener totales banco:', error)
    res.status(500).json({ success: false, message: 'Error al obtener totales banco' })
  }
}
