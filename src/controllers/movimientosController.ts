import { Request, Response } from 'express'
import { query } from '../config/database'
import {
  normalizarFecha,
  formatearFechaRespuesta,
  normalizarIds,
  verificarAccesoMovimientos,
  verificarAccesoSucursal,
} from '../utils/movimientosHelpers'

// Re-exports para que las rutas no necesiten cambiar
export * from './movimientos/efectivoController'
export * from './movimientos/bancoController'
export * from './movimientos/pagosPendientesController'

// GET /api/movimientos/deudas?sucursalId=&fechaInicio=&fechaFin=
export const getDeudasInterSucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId, fechaInicio, fechaFin } = req.query as {
      sucursalId?: string
      fechaInicio?: string
      fechaFin?: string
    }

    if (!sucursalId) {
      return res.status(400).json({ success: false, message: 'sucursalId es requerido' })
    }

    let sql = `
      SELECT
        m.id, m.sucursal_id, m.fecha, m.concepto, m.monto, m.comentarios,
        m.tipo, m.tipo_movimiento, m.saldo, m.estado, m.es_deuda,
        m.fecha_original_vencimiento, m.moneda,
        suc.nombre AS sucursal_nombre
      FROM movimientos m
      INNER JOIN sucursales suc ON m.sucursal_id = suc.id
      WHERE m.es_deuda = 1
        AND m.sucursal_id = ?
        AND suc.activo = 1
    `
    const params: (string | number)[] = [String(sucursalId)]

    if (fechaInicio) {
      sql += ` AND m.fecha >= ?`
      params.push(`${fechaInicio} 00:00:00`)
    }
    if (fechaFin) {
      sql += ` AND m.fecha <= ?`
      params.push(`${fechaFin} 23:59:59`)
    }
    sql += ` ORDER BY m.id DESC`

    const result: any = await query(sql, params)
    const resultFormatted = result.map((m: any) => ({
      ...m,
      fecha: formatearFechaRespuesta(m.fecha),
      fecha_original_vencimiento: m.fecha_original_vencimiento
        ? formatearFechaRespuesta(m.fecha_original_vencimiento)
        : null,
    }))

    return res.json({ success: true, data: resultFormatted })
  } catch (error) {
    console.error('Error en getDeudasInterSucursal:', error)
    return res.status(500).json({ success: false, message: 'Error interno del servidor' })
  }
}

// DELETE /api/movimientos/bulk  — Body: { ids: number[] }
export const deleteBulkMovimientos = async (req: Request, res: Response) => {
  try {
    const ids = normalizarIds(req.body.ids)

    if (!ids) {
      return res.status(400).json({ success: false, message: 'Se requiere un array de ids numéricos no vacío.' })
    }

    // El usuario debe tener acceso a las sucursales de TODOS los movimientos a eliminar
    if (!(await verificarAccesoMovimientos(req.user!, ids))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a alguno de los movimientos.' })
    }

    // Soft delete — consistente con el resto del sistema (deleted_at)
    const placeholders = ids.map(() => '?').join(', ')
    const result: any = await query(
      `UPDATE movimientos SET deleted_at = NOW() WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      ids,
    )
    res.json({ success: true, message: `${result.affectedRows ?? ids.length} movimiento(s) eliminado(s).` })
  } catch (error) {
    console.error('Error en deleteBulkMovimientos:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar movimientos en bloque.' })
  }
}

// PUT /api/movimientos/bulk/mover
export const moverBulkMovimientos = async (req: Request, res: Response) => {
  try {
    const {
      ids,
      destino_sucursal_id,
      destino_tipo_movimiento,
      destino_saldo,
      banco_id,
      medio_pago_id,
      numero_cheque,
      banco,
      cuenta,
      cbu,
      tipo_operacion,
    } = req.body

    const idsNormalizados = normalizarIds(ids)
    if (!idsNormalizados) {
      return res.status(400).json({ success: false, message: 'Se requiere un array de ids numéricos no vacío.' })
    }
    if (!destino_sucursal_id || !destino_tipo_movimiento || !destino_saldo) {
      return res.status(400).json({ success: false, message: 'Faltan datos de destino obligatorios.' })
    }

    // Acceso a los movimientos de origen y a la sucursal de destino
    if (!(await verificarAccesoMovimientos(req.user!, idsNormalizados))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a alguno de los movimientos.' })
    }
    if (!(await verificarAccesoSucursal(req.user!, destino_sucursal_id))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a la sucursal de destino.' })
    }

    const nuevoEstado = destino_saldo === 'saldo_real' ? 'completado' : 'aprobado'
    const placeholders = idsNormalizados.map(() => '?').join(', ')

    if (destino_tipo_movimiento === 'efectivo') {
      await query(
        `UPDATE movimientos
         SET sucursal_id = ?, tipo_movimiento = 'efectivo', saldo = ?, estado = ?,
             banco_id = NULL, medio_pago_id = NULL, numero_cheque = NULL,
             banco = NULL, cuenta = NULL, cbu = NULL, tipo_operacion = NULL
         WHERE id IN (${placeholders})`,
        [destino_sucursal_id, destino_saldo, nuevoEstado, ...idsNormalizados],
      )
    } else {
      await query(
        `UPDATE movimientos
         SET sucursal_id = ?, tipo_movimiento = 'banco', saldo = ?, estado = ?,
             banco_id = ?, medio_pago_id = ?, numero_cheque = ?,
             banco = ?, cuenta = ?, cbu = ?, tipo_operacion = ?
         WHERE id IN (${placeholders})`,
        [
          destino_sucursal_id,
          destino_saldo,
          nuevoEstado,
          banco_id || null,
          medio_pago_id || null,
          numero_cheque || null,
          banco || null,
          cuenta || null,
          cbu || null,
          tipo_operacion || null,
          ...idsNormalizados,
        ],
      )
    }

    res.json({ success: true, message: `${idsNormalizados.length} movimiento(s) movido(s).` })
  } catch (error) {
    console.error('Error en moverBulkMovimientos:', error)
    res.status(500).json({ success: false, message: 'Error al mover movimientos en bloque.' })
  }
}

// POST /api/movimientos/compra-venta-divisas
// compra: ingresa USD, egresa ARS | venta: egresa USD, ingresa ARS
export const compraVentaDivisas = async (req: Request, res: Response) => {
  try {
    const { sucursal_id, user_id, fecha, cantidad_usd, cotizacion, operacion, concepto, comentarios } = req.body

    if (!sucursal_id || !user_id || !fecha || cantidad_usd === undefined || cotizacion === undefined || !operacion) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos: sucursal_id, user_id, fecha, cantidad_usd, cotizacion, operacion',
      })
    }

    if (operacion !== 'compra' && operacion !== 'venta') {
      return res.status(400).json({ success: false, message: 'operacion debe ser "compra" o "venta"' })
    }

    const montoUsd = Math.abs(Number(cantidad_usd))
    const montoArs = montoUsd * Math.abs(Number(cotizacion))

    if (isNaN(montoUsd) || isNaN(montoArs) || montoUsd <= 0) {
      return res.status(400).json({ success: false, message: 'cantidad_usd y cotizacion deben ser números positivos' })
    }

    const fechaOp = normalizarFecha(fecha)
    const conceptoFinal = concepto || (operacion === 'compra' ? 'Compra de divisas (USD)' : 'Venta de divisas (USD)')
    const comentariosFinal = comentarios || null

    // Venta: egresa USD, ingresa ARS — Compra: ingresa USD, egresa ARS
    const montoUsdMovimiento = operacion === 'venta' ? -montoUsd : montoUsd
    const montoArsMovimiento = operacion === 'venta' ? montoArs : -montoArs
    const tipoUsd = operacion === 'venta' ? 'egreso' : 'ingreso'
    const tipoArs = operacion === 'venta' ? 'ingreso' : 'egreso'

    const resultUsd: any = await query(
      `INSERT INTO movimientos
       (sucursal_id, user_id, fecha, concepto, comentarios, monto, saldo, tipo_movimiento, prioridad, estado, tipo, moneda, tipo_cambio)
       VALUES (?, ?, ?, ?, ?, ?, 'saldo_real', 'efectivo', 'media', 'completado', ?, 'USD', ?)`,
      [sucursal_id, user_id, fechaOp, conceptoFinal, comentariosFinal, montoUsdMovimiento, tipoUsd, Number(cotizacion)],
    )

    const resultArs: any = await query(
      `INSERT INTO movimientos
       (sucursal_id, user_id, fecha, concepto, comentarios, monto, saldo, tipo_movimiento, prioridad, estado, tipo, moneda, tipo_cambio)
       VALUES (?, ?, ?, ?, ?, ?, 'saldo_real', 'efectivo', 'media', 'completado', ?, 'ARS', NULL)`,
      [sucursal_id, user_id, fechaOp, conceptoFinal, comentariosFinal, montoArsMovimiento, tipoArs],
    )

    const [movUsd, movArs]: any[] = await Promise.all([
      query('SELECT * FROM movimientos WHERE id = ?', [resultUsd.insertId]),
      query('SELECT * FROM movimientos WHERE id = ?', [resultArs.insertId]),
    ])

    res.status(201).json({
      success: true,
      message: `Operación de ${operacion} de divisas registrada exitosamente`,
      data: {
        movimiento_usd: (movUsd as any[])[0],
        movimiento_ars: (movArs as any[])[0],
        resumen: { operacion, cantidad_usd: montoUsd, cotizacion: Number(cotizacion), monto_ars: montoArs },
      },
    })
  } catch (error) {
    console.error('Error en compra-venta de divisas:', error)
    res.status(500).json({ success: false, message: 'Error al registrar la operación de compra-venta de divisas' })
  }
}

// PUT /api/movimientos/:id/mover
export const moverMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const {
      destino_tipo_movimiento,
      destino_saldo,
      destino_sucursal_id,
      banco_id,
      medio_pago_id,
      numero_cheque,
      banco,
      cuenta,
      cbu,
      tipo_operacion,
      nota_descripcion,
      es_credito,
    } = req.body

    if (!destino_tipo_movimiento || !destino_saldo || !destino_sucursal_id) {
      return res.status(400).json({ success: false, message: 'Faltan datos de destino obligatorios.' })
    }

    const movResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' })
    }

    const mov = movResult[0]
    const conceptoDeudaBase = mov.concepto || 'Sin concepto'
    const isDifferentSucursal = String(mov.sucursal_id) !== String(destino_sucursal_id)
    const createDebts = es_credito && isDifferentSucursal

    const [sucOrigenResult, sucDestinoResult]: any[] = await Promise.all([
      query('SELECT nombre FROM sucursales WHERE id = ?', [mov.sucursal_id]),
      query('SELECT nombre FROM sucursales WHERE id = ?', [destino_sucursal_id]),
    ])
    const nombreOrigen = sucOrigenResult?.[0]?.nombre ?? `Sucursal ${mov.sucursal_id}`
    const nombreDestino = sucDestinoResult?.[0]?.nombre ?? `Sucursal ${destino_sucursal_id}`

    let nuevaDescripcion = mov.comentarios || ''
    if (nota_descripcion) {
      const separador = '\n📌 Nota interna: '
      if (nuevaDescripcion.includes(separador)) {
        nuevaDescripcion = nuevaDescripcion.split(separador)[0].trim()
      }
      nuevaDescripcion = nuevaDescripcion ? `${nuevaDescripcion}${separador}${nota_descripcion}` : `${nota_descripcion}`
    }

    const nuevoTipo = createDebts ? (mov.tipo === 'ingreso' ? 'egreso' : 'ingreso') : mov.tipo
    const nuevoEstado = destino_saldo === 'saldo_real' ? 'completado' : 'aprobado'

    const getSignedMonto = (t: string, m: number) => (t === 'egreso' ? -Math.abs(m) : Math.abs(m))

    const camposBanco = (overrides: Record<string, any> = {}) => ({
      banco_id: overrides.banco_id ?? banco_id ?? mov.banco_id ?? null,
      medio_pago_id: overrides.medio_pago_id ?? medio_pago_id ?? mov.medio_pago_id ?? null,
      numero_cheque: overrides.numero_cheque ?? numero_cheque ?? mov.numero_cheque ?? null,
      banco: overrides.banco ?? banco ?? mov.banco ?? null,
      cuenta: overrides.cuenta ?? cuenta ?? mov.cuenta ?? null,
      cbu: overrides.cbu ?? cbu ?? mov.cbu ?? null,
      tipo_operacion: overrides.tipo_operacion ?? tipo_operacion ?? mov.tipo_operacion ?? null,
    })

    if (createDebts) {
      if (mov.tipo === 'ingreso') {
        // CASO 1: Muevo un ingreso → Egreso real en origen, Ingreso real en destino, deudas cruzadas
        await query(`UPDATE movimientos SET tipo = ?, estado = 'completado', comentarios = ?, monto = ? WHERE id = ?`, [
          'egreso',
          nuevaDescripcion,
          getSignedMonto('egreso', mov.monto),
          id,
        ])

        const cb = camposBanco()
        await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, comentarios,
            tipo, tipo_movimiento, saldo, estado, banco_id, medio_pago_id,
            numero_cheque, banco, cuenta, cbu, tipo_operacion
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            destino_sucursal_id,
            mov.user_id,
            mov.concepto,
            getSignedMonto('ingreso', mov.monto),
            nuevaDescripcion,
            'ingreso',
            destino_tipo_movimiento,
            destino_saldo,
            nuevoEstado,
            destino_tipo_movimiento === 'banco' ? cb.banco_id : null,
            destino_tipo_movimiento === 'banco' ? cb.medio_pago_id : null,
            destino_tipo_movimiento === 'banco' ? cb.numero_cheque : null,
            destino_tipo_movimiento === 'banco' ? cb.banco : null,
            destino_tipo_movimiento === 'banco' ? cb.cuenta : null,
            destino_tipo_movimiento === 'banco' ? cb.cbu : null,
            destino_tipo_movimiento === 'banco' ? cb.tipo_operacion : null,
          ],
        )

        const insertOrigenDeuda: any = await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, comentarios,
            tipo, tipo_movimiento, saldo, estado, es_deuda
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', 1)`,
          [
            mov.sucursal_id,
            mov.user_id,
            `${conceptoDeudaBase} [DEUDA]`,
            getSignedMonto('ingreso', mov.monto),
            `Crédito auto-generado por movimiento hacia ${nombreDestino}`,
            'ingreso',
            mov.tipo_movimiento,
          ],
        )

        const insertDestinoDeuda: any = await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, comentarios,
            tipo, tipo_movimiento, saldo, estado, es_deuda
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', 1)`,
          [
            destino_sucursal_id,
            mov.user_id,
            `${conceptoDeudaBase} [DEUDA]`,
            getSignedMonto('egreso', mov.monto),
            `Deuda auto-generada recibida de ${nombreOrigen}`,
            'egreso',
            destino_tipo_movimiento,
          ],
        )

        await query(`UPDATE movimientos SET movimiento_contraparte_id = ? WHERE id = ?`, [
          insertDestinoDeuda.insertId,
          insertOrigenDeuda.insertId,
        ])
        await query(`UPDATE movimientos SET movimiento_contraparte_id = ? WHERE id = ?`, [
          insertOrigenDeuda.insertId,
          insertDestinoDeuda.insertId,
        ])
      } else {
        // CASO 2: Muevo un egreso → Muevo el registro al destino, deudas cruzadas
        if (destino_tipo_movimiento === 'efectivo') {
          await query(
            `UPDATE movimientos
             SET sucursal_id = ?, tipo_movimiento = 'efectivo', saldo = ?, estado = ?, comentarios = ?, tipo = ?, monto = ?,
                 banco_id = NULL, medio_pago_id = NULL, numero_cheque = NULL, banco = NULL, cuenta = NULL, cbu = NULL, tipo_operacion = NULL
             WHERE id = ?`,
            [
              destino_sucursal_id,
              destino_saldo,
              nuevoEstado,
              nuevaDescripcion,
              'egreso',
              getSignedMonto('egreso', mov.monto),
              id,
            ],
          )
        } else {
          const cb = camposBanco()
          await query(
            `UPDATE movimientos
             SET sucursal_id = ?, tipo_movimiento = 'banco', saldo = ?, estado = ?, comentarios = ?, tipo = ?, monto = ?,
                 banco_id = ?, medio_pago_id = ?, numero_cheque = ?, banco = ?, cuenta = ?, cbu = ?, tipo_operacion = ?
             WHERE id = ?`,
            [
              destino_sucursal_id,
              destino_saldo,
              nuevoEstado,
              nuevaDescripcion,
              'egreso',
              getSignedMonto('egreso', mov.monto),
              cb.banco_id,
              cb.medio_pago_id,
              cb.numero_cheque,
              cb.banco,
              cb.cuenta,
              cb.cbu,
              cb.tipo_operacion,
              id,
            ],
          )
        }

        const insertOrigenDeuda2: any = await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, comentarios,
            tipo, tipo_movimiento, saldo, estado, es_deuda
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', 1)`,
          [
            mov.sucursal_id,
            mov.user_id,
            `${conceptoDeudaBase} [DEUDA]`,
            getSignedMonto('egreso', mov.monto),
            `Deuda auto-generada por mover consumo (egreso) a ${nombreDestino}`,
            'egreso',
            mov.tipo_movimiento,
          ],
        )

        const insertDestinoDeuda2: any = await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, comentarios,
            tipo, tipo_movimiento, saldo, estado, es_deuda
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', 1)`,
          [
            destino_sucursal_id,
            mov.user_id,
            `${conceptoDeudaBase} [DEUDA]`,
            getSignedMonto('ingreso', mov.monto),
            `Crédito a cobrar generado al asumir consumo (egreso) desde ${nombreOrigen}`,
            'ingreso',
            destino_tipo_movimiento,
          ],
        )

        await query(`UPDATE movimientos SET movimiento_contraparte_id = ? WHERE id = ?`, [
          insertDestinoDeuda2.insertId,
          insertOrigenDeuda2.insertId,
        ])
        await query(`UPDATE movimientos SET movimiento_contraparte_id = ? WHERE id = ?`, [
          insertOrigenDeuda2.insertId,
          insertDestinoDeuda2.insertId,
        ])
      }
    } else {
      // FLUJO NORMAL: Solo mover de sucursal
      if (destino_tipo_movimiento === 'efectivo') {
        await query(
          `UPDATE movimientos
           SET sucursal_id = ?, tipo_movimiento = 'efectivo', saldo = ?, estado = ?, comentarios = ?, tipo = ?,
               banco_id = NULL, medio_pago_id = NULL, numero_cheque = NULL, banco = NULL, cuenta = NULL, cbu = NULL, tipo_operacion = NULL
           WHERE id = ?`,
          [destino_sucursal_id, destino_saldo, nuevoEstado, nuevaDescripcion, nuevoTipo, id],
        )
      } else {
        const cb = camposBanco()
        await query(
          `UPDATE movimientos
           SET sucursal_id = ?, tipo_movimiento = 'banco', saldo = ?, estado = ?, comentarios = ?, tipo = ?,
               banco_id = ?, medio_pago_id = ?, numero_cheque = ?, banco = ?, cuenta = ?, cbu = ?, tipo_operacion = ?
           WHERE id = ?`,
          [
            destino_sucursal_id,
            destino_saldo,
            nuevoEstado,
            nuevaDescripcion,
            nuevoTipo,
            cb.banco_id,
            cb.medio_pago_id,
            cb.numero_cheque,
            cb.banco,
            cb.cuenta,
            cb.cbu,
            cb.tipo_operacion,
            id,
          ],
        )
      }
    }

    const updatedResult: any = await query('SELECT * FROM movimientos WHERE id = ?', [id])
    res.json({ success: true, message: 'Movimiento movido exitosamente', data: updatedResult[0] })
  } catch (error) {
    console.error('Error al mover movimiento:', error)
    res.status(500).json({ success: false, message: 'Error al mover movimiento' })
  }
}
