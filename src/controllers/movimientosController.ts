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

// POST /api/movimientos/efectivo
export const createMovimientoEfectivo = async (req: Request, res: Response) => {
  try {
    const {
      sucursal_id,
      fecha,
      concepto,
      descripcion,
      monto,
      tipo_movimiento,
      prioridad
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
      `INSERT INTO movimientos_caja_efectivo 
       (sucursal_id, fecha, concepto, descripcion, monto, tipo_movimiento, prioridad, estado) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completado')`,
      [sucursal_id, fecha, concepto, descripcion || null, monto, tipo_movimiento, prioridad || 'media']
    );

    // Obtener el movimiento creado
    const createdMovimiento: any = await query(
      'SELECT * FROM movimientos_caja_efectivo WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Movimiento creado exitosamente',
      data: createdMovimiento[0]
    });

  } catch (error) {
    console.error('Error al crear movimiento:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear movimiento'
    });
  }
};

// PUT /api/movimientos/efectivo/:id/mover-a-real
export const moverAReal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar que existe y está en saldo_necesario
    const movResult: any = await query(
      'SELECT * FROM movimientos_caja_efectivo WHERE id = ?',
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
      `UPDATE movimientos_caja_efectivo 
       SET tipo_movimiento = 'saldo_real', estado = 'completado' 
       WHERE id = ?`,
      [id]
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      'SELECT * FROM movimientos_caja_efectivo WHERE id = ?',
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

// GET /api/movimientos/efectivo/:sucursalId/totales
export const getTotalesEfectivo = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;

    const result: any = await query(
      `SELECT 
        SUM(CASE WHEN tipo_movimiento = 'saldo_real' THEN monto ELSE 0 END) as total_real,
        SUM(CASE WHEN tipo_movimiento = 'saldo_necesario' THEN monto ELSE 0 END) as total_necesario
       FROM movimientos_caja_efectivo 
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
    console.error('Error al obtener totales:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener totales'
    });
  }
};
