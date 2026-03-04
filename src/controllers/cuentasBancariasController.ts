import { Request, Response } from 'express';
import { query } from '../config/database';

// GET /api/cuentas-bancarias/:sucursalId
export const getCuentasBancarias = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;
    const result: any = await query(
      'SELECT * FROM cuentas_bancarias_sucursal WHERE sucursal_id = ? ORDER BY id ASC',
      [sucursalId]
    );

    res.json({
      success: true,
      data: result || []
    });
  } catch (error) {
    console.error('Error al obtener cuentas bancarias:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener cuentas bancarias'
    });
  }
};

// POST /api/cuentas-bancarias/:sucursalId
export const createCuentaBancaria = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;
    const { cbu, alias, tipo_cuenta, banco } = req.body;

    if (!cbu) {
      return res.status(400).json({
        success: false,
        message: 'El CBU es requerido'
      });
    }

    const insertResult: any = await query(
      'INSERT INTO cuentas_bancarias_sucursal (sucursal_id, cbu, alias, tipo_cuenta, banco) VALUES (?, ?, ?, ?, ?)',
      [sucursalId, cbu, alias || null, tipo_cuenta || null, banco || null]
    );

    res.status(201).json({
      success: true,
      data: {
        id: insertResult.insertId,
        sucursal_id: sucursalId,
        cbu,
        alias,
        tipo_cuenta,
        banco
      }
    });
  } catch (error) {
    console.error('Error al crear cuenta bancaria:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear cuenta bancaria'
    });
  }
};

// PUT /api/cuentas-bancarias/:id
export const updateCuentaBancaria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { cbu, alias, tipo_cuenta, banco } = req.body;

    if (!cbu) {
      return res.status(400).json({
        success: false,
        message: 'El CBU es requerido'
      });
    }

    await query(
      'UPDATE cuentas_bancarias_sucursal SET cbu = ?, alias = ?, tipo_cuenta = ?, banco = ? WHERE id = ?',
      [cbu, alias || null, tipo_cuenta || null, banco || null, id]
    );

    res.json({
      success: true,
      message: 'Cuenta bancaria actualizada correctamente'
    });
  } catch (error) {
    console.error('Error al actualizar cuenta bancaria:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar cuenta bancaria'
    });
  }
};

// DELETE /api/cuentas-bancarias/:id
export const deleteCuentaBancaria = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await query(
      'DELETE FROM cuentas_bancarias_sucursal WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Cuenta bancaria eliminada correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar cuenta bancaria:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar cuenta bancaria'
    });
  }
};
