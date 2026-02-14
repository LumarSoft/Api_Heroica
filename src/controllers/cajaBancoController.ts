import { Request, Response } from 'express';
import { query } from '../config/database';

// GET /api/caja-banco/:sucursalId
export const getMovimientosBancoBySucursal = async (req: Request, res: Response) => {
    try {
        const { sucursalId } = req.params;

        const result: any = await query(
            `SELECT id, sucursal_id, fecha, concepto, monto, descripcion, prioridad, 
              tipo_movimiento, estado, numero_cheque, banco, cuenta, cbu, 
              tipo_operacion, pago_pendiente_id, created_at, updated_at 
       FROM movimientos_caja_banco 
       WHERE sucursal_id = ? 
       ORDER BY fecha DESC`,
            [sucursalId]
        );

        // Agrupar por tipo de movimiento
        const movimientos = {
            saldo_real: result.filter((m: any) => m.tipo_movimiento === 'saldo_real'),
            saldo_necesario: result.filter((m: any) => m.tipo_movimiento === 'saldo_necesario'),
        };

        res.json({
            success: true,
            data: movimientos
        });

    } catch (error) {
        console.error('Error al obtener movimientos banco:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener movimientos banco'
        });
    }
};

// POST /api/caja-banco
export const createMovimientoBanco = async (req: Request, res: Response) => {
    try {
        const {
            sucursal_id,
            fecha,
            concepto,
            descripcion,
            monto,
            tipo_movimiento,
            prioridad,
            numero_cheque,
            banco,
            cuenta,
            cbu,
            tipo_operacion
        } = req.body;

        // Validación
        if (!sucursal_id || !fecha || !concepto || monto === undefined || !tipo_movimiento) {
            return res.status(400).json({
                success: false,
                message: 'Faltan campos requeridos'
            });
        }

        // Crear movimiento
        const result: any = await query(
            `INSERT INTO movimientos_caja_banco 
       (sucursal_id, fecha, concepto, descripcion, monto, tipo_movimiento, prioridad,
        numero_cheque, banco, cuenta, cbu, tipo_operacion, estado) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completado')`,
            [sucursal_id, fecha, concepto, descripcion || null, monto, tipo_movimiento,
                prioridad || 'media', numero_cheque || null, banco || null, cuenta || null,
                cbu || null, tipo_operacion || null]
        );

        // Obtener el movimiento creado
        const createdMovimiento: any = await query(
            'SELECT * FROM movimientos_caja_banco WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Movimiento creado exitosamente',
            data: createdMovimiento[0]
        });

    } catch (error) {
        console.error('Error al crear movimiento banco:', error);
        res.status(500).json({
            success: false,
            message: 'Error al crear movimiento banco'
        });
    }
};

// PUT /api/caja-banco/:id
export const updateMovimientoBanco = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const {
            fecha,
            concepto,
            monto,
            descripcion,
            prioridad,
            numero_cheque,
            banco,
            cuenta,
            cbu,
            tipo_operacion
        } = req.body;

        // Validación
        if (!fecha || !concepto || monto === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Fecha, concepto y monto son requeridos'
            });
        }

        // Verificar que existe
        const existingResult: any = await query(
            'SELECT id FROM movimientos_caja_banco WHERE id = ?',
            [id]
        );

        if (!Array.isArray(existingResult) || existingResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Movimiento no encontrado'
            });
        }

        // Actualizar
        await query(
            `UPDATE movimientos_caja_banco 
       SET fecha = ?, concepto = ?, monto = ?, descripcion = ?, prioridad = ?,
           numero_cheque = ?, banco = ?, cuenta = ?, cbu = ?, tipo_operacion = ?
       WHERE id = ?`,
            [fecha, concepto, monto, descripcion || null, prioridad || 'media',
                numero_cheque || null, banco || null, cuenta || null, cbu || null,
                tipo_operacion || null, id]
        );

        // Obtener el movimiento actualizado
        const updatedResult: any = await query(
            'SELECT * FROM movimientos_caja_banco WHERE id = ?',
            [id]
        );

        res.json({
            success: true,
            message: 'Movimiento actualizado exitosamente',
            data: updatedResult[0]
        });

    } catch (error) {
        console.error('Error al actualizar movimiento banco:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar movimiento banco'
        });
    }
};

// DELETE /api/caja-banco/:id
export const deleteMovimientoBanco = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Verificar que existe
        const existingResult: any = await query(
            'SELECT id FROM movimientos_caja_banco WHERE id = ?',
            [id]
        );

        if (!Array.isArray(existingResult) || existingResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Movimiento no encontrado'
            });
        }

        // Eliminar
        await query('DELETE FROM movimientos_caja_banco WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Movimiento eliminado exitosamente'
        });

    } catch (error) {
        console.error('Error al eliminar movimiento banco:', error);
        res.status(500).json({
            success: false,
            message: 'Error al eliminar movimiento banco'
        });
    }
};

// PUT /api/caja-banco/:id/mover-a-real
export const moverAReal = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Verificar que existe y está en saldo_necesario
        const movResult: any = await query(
            'SELECT * FROM movimientos_caja_banco WHERE id = ?',
            [id]
        );

        if (!Array.isArray(movResult) || movResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Movimiento no encontrado'
            });
        }

        if (movResult[0].tipo_movimiento !== 'saldo_necesario') {
            return res.status(400).json({
                success: false,
                message: 'El movimiento no está en saldo necesario'
            });
        }

        // Mover a saldo real
        await query(
            `UPDATE movimientos_caja_banco 
       SET tipo_movimiento = 'saldo_real', estado = 'completado' 
       WHERE id = ?`,
            [id]
        );

        // Obtener el movimiento actualizado
        const updatedResult: any = await query(
            'SELECT * FROM movimientos_caja_banco WHERE id = ?',
            [id]
        );

        res.json({
            success: true,
            message: 'Movimiento movido a saldo real exitosamente',
            data: updatedResult[0]
        });

    } catch (error) {
        console.error('Error al mover movimiento:', error);
        res.status(500).json({
            success: false,
            message: 'Error al mover movimiento'
        });
    }
};

// GET /api/caja-banco/:sucursalId/totales
export const getTotalesBanco = async (req: Request, res: Response) => {
    try {
        const { sucursalId } = req.params;

        const result: any = await query(
            `SELECT 
        SUM(CASE WHEN tipo_movimiento = 'saldo_real' THEN monto ELSE 0 END) as total_real,
        SUM(CASE WHEN tipo_movimiento = 'saldo_necesario' THEN monto ELSE 0 END) as total_necesario
       FROM movimientos_caja_banco 
       WHERE sucursal_id = ?`,
            [sucursalId]
        );

        res.json({
            success: true,
            data: {
                total_real: result[0]?.total_real || 0,
                total_necesario: result[0]?.total_necesario || 0
            }
        });

    } catch (error) {
        console.error('Error al obtener totales banco:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener totales banco'
        });
    }
};

// PUT /api/caja-banco/:id/estado
export const updateEstadoMovimientoBanco = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;

        // Validación
        const estadosValidos = ['pendiente', 'aprobado', 'rechazado', 'completado'];
        if (!estado || !estadosValidos.includes(estado)) {
            return res.status(400).json({
                success: false,
                message: 'Estado inválido'
            });
        }

        // Verificar que existe
        const existingResult: any = await query(
            'SELECT id FROM movimientos_caja_banco WHERE id = ?',
            [id]
        );

        if (!Array.isArray(existingResult) || existingResult.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Movimiento no encontrado'
            });
        }

        // Actualizar estado
        await query(
            'UPDATE movimientos_caja_banco SET estado = ? WHERE id = ?',
            [estado, id]
        );

        // Obtener el movimiento actualizado
        const updatedResult: any = await query(
            'SELECT * FROM movimientos_caja_banco WHERE id = ?',
            [id]
        );

        res.json({
            success: true,
            message: 'Estado actualizado exitosamente',
            data: updatedResult[0]
        });

    } catch (error) {
        console.error('Error al actualizar estado:', error);
        res.status(500).json({
            success: false,
            message: 'Error al actualizar estado'
        });
    }
};
