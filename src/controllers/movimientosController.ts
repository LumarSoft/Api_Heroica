import { Request, Response } from 'express';
import { query } from '../config/database';

// GET /api/movimientos/:sucursalId
export const getMovimientosBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;

    // Obtener todos los movimientos de la sucursal
    const result: any = await query(
      `SELECT id, sucursal_id, fecha, concepto, monto, descripcion, prioridad, tipo_movimiento, estado, created_at, updated_at 
       FROM movimientos_caja_efectivo 
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
    console.error('Error al obtener movimientos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener movimientos'
    });
  }
};

// PUT /api/movimientos/:id
export const updateMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { fecha, concepto, monto, descripcion, prioridad } = req.body;

    // Validación
    if (!fecha || !concepto || monto === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Fecha, concepto y monto son requeridos'
      });
    }

    // Verificar que el movimiento existe
    const existingResult: any = await query(
      'SELECT id FROM movimientos_caja_efectivo WHERE id = ?',
      [id]
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Movimiento no encontrado'
      });
    }

    // Actualizar movimiento
    await query(
      `UPDATE movimientos_caja_efectivo 
       SET fecha = ?, concepto = ?, monto = ?, descripcion = ?, prioridad = ? 
       WHERE id = ?`,
      [fecha, concepto, monto, descripcion || null, prioridad || 'media', id]
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      'SELECT * FROM movimientos_caja_efectivo WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Movimiento actualizado exitosamente',
      data: updatedResult[0]
    });

  } catch (error) {
    console.error('Error al actualizar movimiento:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar movimiento'
    });
  }
};

// DELETE /api/movimientos/:id
export const deleteMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar que el movimiento existe
    const existingResult: any = await query(
      'SELECT id FROM movimientos_caja_efectivo WHERE id = ?',
      [id]
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Movimiento no encontrado'
      });
    }

    // Eliminar movimiento (hard delete)
    await query(
      'DELETE FROM movimientos_caja_efectivo WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Movimiento eliminado exitosamente'
    });

  } catch (error) {
    console.error('Error al eliminar movimiento:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar movimiento'
    });
  }
};

// PUT /api/movimientos/:id/estado
export const updateEstadoMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    // Validación
    const estadosValidos = ['pendiente', 'aprobado', 'rechazado', 'completado'];
    if (!estado || !estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: 'Estado inválido. Debe ser: pendiente, aprobado, rechazado o completado'
      });
    }

    // Verificar que el movimiento existe
    const existingResult: any = await query(
      'SELECT id FROM movimientos_caja_efectivo WHERE id = ?',
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
      'UPDATE movimientos_caja_efectivo SET estado = ? WHERE id = ?',
      [estado, id]
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      'SELECT * FROM movimientos_caja_efectivo WHERE id = ?',
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
