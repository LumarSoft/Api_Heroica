import { Request, Response } from 'express';
import { query } from '../config/database';

// GET /api/sucursales
export const getSucursales = async (req: Request, res: Response) => {
  try {
    // Obtener todas las sucursales activas
    const result: any = await query(
      'SELECT id, nombre, razon_social, cuit, direccion, activo FROM sucursales WHERE activo = TRUE ORDER BY nombre ASC'
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error al obtener sucursales:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener sucursales'
    });
  }
};

// GET /api/sucursales/:id
export const getSucursalById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result: any = await query(
      'SELECT * FROM sucursales WHERE id = ?',
      [id]
    );

    if (!Array.isArray(result) || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sucursal no encontrada'
      });
    }

    res.json({
      success: true,
      data: result[0]
    });

  } catch (error) {
    console.error('Error al obtener sucursal:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener sucursal'
    });
  }
};

// POST /api/sucursales
export const createSucursal = async (req: Request, res: Response) => {
  try {
    const { nombre, razon_social, cuit, direccion } = req.body;

    // Validación
    if (!nombre || !razon_social || !cuit || !direccion) {
      return res.status(400).json({
        success: false,
        message: 'Todos los campos son requeridos'
      });
    }

    // Insertar sucursal
    const result: any = await query(
      'INSERT INTO sucursales (nombre, razon_social, cuit, direccion) VALUES (?, ?, ?, ?)',
      [nombre, razon_social, cuit, direccion]
    );

    res.status(201).json({
      success: true,
      message: 'Sucursal creada exitosamente',
      data: {
        id: result.insertId,
        nombre,
        razon_social,
        cuit,
        direccion
      }
    });

  } catch (error: any) {
    console.error('Error al crear sucursal:', error);

    // Error de CUIT duplicado
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'El CUIT ya está registrado'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error al crear sucursal'
    });
  }
};

// PUT /api/sucursales/:id
export const updateSucursal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { nombre, razon_social, cuit, direccion, email_correspondencia } = req.body;

    // Validación
    if (!nombre || !razon_social || !cuit || !direccion) {
      return res.status(400).json({
        success: false,
        message: 'Todos los campos son requeridos'
      });
    }

    // Verificar que la sucursal existe
    const existingResult: any = await query(
      'SELECT id FROM sucursales WHERE id = ?',
      [id]
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sucursal no encontrada'
      });
    }

    // Actualizar sucursal
    await query(
      'UPDATE sucursales SET nombre = ?, razon_social = ?, cuit = ?, direccion = ?, email_correspondencia = ? WHERE id = ?',
      [nombre, razon_social, cuit, direccion, email_correspondencia || null, id]
    );

    res.json({
      success: true,
      message: 'Sucursal actualizada exitosamente',
      data: {
        id: parseInt(id),
        nombre,
        razon_social,
        cuit,
        direccion,
        email_correspondencia
      }
    });

  } catch (error: any) {
    console.error('Error al actualizar sucursal:', error);

    // Error de CUIT duplicado
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'El CUIT ya está registrado'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error al actualizar sucursal'
    });
  }
};

// DELETE /api/sucursales/:id (soft delete)
export const deleteSucursal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar que la sucursal existe
    const existingResult: any = await query(
      'SELECT id FROM sucursales WHERE id = ?',
      [id]
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sucursal no encontrada'
      });
    }

    // Soft delete: marcar como inactiva
    await query(
      'UPDATE sucursales SET activo = FALSE WHERE id = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Sucursal eliminada exitosamente'
    });

  } catch (error) {
    console.error('Error al eliminar sucursal:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar sucursal'
    });
  }
};

