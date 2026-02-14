import { Request, Response } from 'express';
import { query } from '../config/database';

// GET /api/pagos-pendientes/:sucursalId
export const getPagosPendientesBySucursal = async (req: Request, res: Response) => {
    try {
        const { sucursalId } = req.params;
        const { estado } = req.query; // Filtro opcional por estado

        let sql = `
      SELECT 
        pp.*,
        uc.nombre as usuario_creador_nombre,
        ur.nombre as usuario_revisor_nombre
      FROM pagos_pendientes pp
      LEFT JOIN usuarios uc ON pp.usuario_creador_id = uc.id
      LEFT JOIN usuarios ur ON pp.usuario_revisor_id = ur.id
      WHERE pp.sucursal_id = ?
    `;

        const params: any[] = [sucursalId];

        if (estado) {
            sql += ' AND pp.estado = ?';
            params.push(estado);
        }

        sql += ' ORDER BY pp.fecha_solicitud DESC';

        const result: any = await query(sql, params);

        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Error al obtener pagos pendientes:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener pagos pendientes'
        });
    }
};

// POST /api/pagos-pendientes
export const createPagoPendiente = async (req: Request, res: Response) => {
    try {
        const {
            sucursal_id,
            usuario_creador_id,
            fecha_pago_programada,
            concepto,
            descripcion,
            monto,
            proveedor,
            tipo_caja,
            prioridad
        } = req.body;

        // Validación
        if (!sucursal_id || !usuario_creador_id || !fecha_pago_programada || !concepto || !monto || !tipo_caja) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos'
            });
        }

        // Validar tipo de caja
        if (!['efectivo', 'banco'].includes(tipo_caja)) {
            return res.status(400).json({
                success: false,
                message: 'Tipo de caja inválido'
            });
        }

        // Crear pago pendiente
        const result: any = await query(
            `INSERT INTO pagos_pendientes 
       (sucursal_id, usuario_creador_id, fecha_pago_programada, concepto, descripcion, 
        monto, proveedor, tipo_caja, prioridad) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sucursal_id, usuario_creador_id, fecha_pago_programada, concepto, descripcion || null,
                monto, proveedor || null, tipo_caja, prioridad || 'media']
        );

        // Obtener el pago creado
        const createdPago: any = await query(
            'SELECT * FROM pagos_pendientes WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Pago pendiente creado exitosamente',
            data: createdPago[0]
        });

    } catch (error) {
        console.error('Error al crear pago pendiente:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear pago pendiente'
        });
    }
};

// PUT /api/pagos-pendientes/:id/aprobar
export const aprobarPagoPendiente = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { usuario_revisor_id } = req.body;

        // Validación
        if (!usuario_revisor_id) {
            return res.status(400).json({
                success: false,
                message: 'ID de usuario revisor es requerido'
            });
        }

        // Obtener el pago pendiente
        const pagoResult: any = await query(
            'SELECT * FROM pagos_pendientes WHERE id = ?',
            [id]
        );

        if (!Array.isArray(pagoResult) || pagoResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pago pendiente no encontrado'
            });
        }

        const pago = pagoResult[0];

        // Verificar que esté pendiente
        if (pago.estado !== 'pendiente') {
            return res.status(400).json({
                success: false,
                message: 'El pago ya fue procesado'
            });
        }

        // Crear movimiento en la caja correspondiente según tipo_caja
        let movimientoId;

        if (pago.tipo_caja === 'efectivo') {
            const movResult: any = await query(
                `INSERT INTO movimientos_caja_efectivo 
         (sucursal_id, fecha, concepto, descripcion, monto, tipo_movimiento, 
          estado, prioridad, pago_pendiente_id) 
         VALUES (?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', ?, ?)`,
                [pago.sucursal_id, pago.fecha_pago_programada, pago.concepto,
                pago.descripcion, -Math.abs(pago.monto), pago.prioridad, id]
            );
            movimientoId = movResult.insertId;
        } else {
            const movResult: any = await query(
                `INSERT INTO movimientos_caja_banco 
         (sucursal_id, fecha, concepto, descripcion, monto, tipo_movimiento, 
          estado, prioridad, pago_pendiente_id) 
         VALUES (?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', ?, ?)`,
                [pago.sucursal_id, pago.fecha_pago_programada, pago.concepto,
                pago.descripcion, -Math.abs(pago.monto), pago.prioridad, id]
            );
            movimientoId = movResult.insertId;
        }

        // Actualizar estado del pago pendiente
        await query(
            `UPDATE pagos_pendientes 
       SET estado = 'aprobado', usuario_revisor_id = ?, fecha_revision = NOW(), movimiento_id = ?
       WHERE id = ?`,
            [usuario_revisor_id, movimientoId, id]
        );

        // Obtener el pago actualizado
        const updatedPago: any = await query(
            'SELECT * FROM pagos_pendientes WHERE id = ?',
            [id]
        );

        res.json({
            success: true,
            message: 'Pago aprobado y programado exitosamente',
            data: updatedPago[0]
        });

    } catch (error) {
        console.error('Error al aprobar pago:', error);
        res.status(500).json({
            success: false,
            message: 'Error al aprobar pago'
        });
    }
};

// PUT /api/pagos-pendientes/:id/rechazar
export const rechazarPagoPendiente = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { usuario_revisor_id, motivo_rechazo } = req.body;

        // Validación
        if (!usuario_revisor_id || !motivo_rechazo) {
            return res.status(400).json({
                success: false,
                message: 'Usuario revisor y motivo de rechazo son requeridos'
            });
        }

        // Verificar que el pago existe y está pendiente
        const pagoResult: any = await query(
            'SELECT * FROM pagos_pendientes WHERE id = ?',
            [id]
        );

        if (!Array.isArray(pagoResult) || pagoResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pago pendiente no encontrado'
            });
        }

        if (pagoResult[0].estado !== 'pendiente') {
            return res.status(400).json({
                success: false,
                message: 'El pago ya fue procesado'
            });
        }

        // Actualizar estado
        await query(
            `UPDATE pagos_pendientes 
       SET estado = 'rechazado', usuario_revisor_id = ?, motivo_rechazo = ?, fecha_revision = NOW()
       WHERE id = ?`,
            [usuario_revisor_id, motivo_rechazo, id]
        );

        // Obtener el pago actualizado
        const updatedPago: any = await query(
            'SELECT * FROM pagos_pendientes WHERE id = ?',
            [id]
        );

        res.json({
            success: true,
            message: 'Pago rechazado exitosamente',
            data: updatedPago[0]
        });

    } catch (error) {
        console.error('Error al rechazar pago:', error);
        res.status(500).json({
            success: false,
            message: 'Error al rechazar pago'
        });
    }
};

// DELETE /api/pagos-pendientes/:id
export const deletePagoPendiente = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Verificar que existe
        const pagoResult: any = await query(
            'SELECT * FROM pagos_pendientes WHERE id = ?',
            [id]
        );

        if (!Array.isArray(pagoResult) || pagoResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Pago pendiente no encontrado'
            });
        }

        // Solo se puede eliminar si está pendiente
        if (pagoResult[0].estado !== 'pendiente') {
            return res.status(400).json({
                success: false,
                message: 'Solo se pueden eliminar pagos pendientes'
            });
        }

        // Eliminar
        await query('DELETE FROM pagos_pendientes WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Pago pendiente eliminado exitosamente'
        });

    } catch (error) {
        console.error('Error al eliminar pago pendiente:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar pago pendiente'
        });
    }
};
