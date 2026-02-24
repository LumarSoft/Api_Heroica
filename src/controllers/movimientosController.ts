import { Request, Response } from "express";
import { query } from "../config/database";

// GET /api/movimientos/:sucursalId
export const getMovimientosBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;

    // Obtener todos los movimientos de la sucursal
    const result: any = await query(
      `SELECT m.id, m.sucursal_id, m.fecha, m.concepto, m.monto, m.descripcion, m.prioridad, 
              m.saldo as tipo_movimiento, m.estado, m.categoria_id, m.subcategoria_id, 
              m.tipo,
              c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
              m.created_at, m.updated_at 
       FROM movimientos m
       LEFT JOIN categorias c ON m.categoria_id = c.id
       LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
       WHERE m.sucursal_id = ? AND m.tipo_movimiento = 'efectivo'
       ORDER BY m.fecha DESC`,
      [sucursalId],
    );

    // Agrupar por tipo de movimiento (que mapea a 'saldo' real o necesario)
    const movimientos = {
      saldo_real: result.filter((m: any) => m.tipo_movimiento === "saldo_real"),
      saldo_necesario: result.filter(
        (m: any) => m.tipo_movimiento === "saldo_necesario",
      ),
    };

    res.json({
      success: true,
      data: movimientos,
    });
  } catch (error) {
    console.error("Error al obtener movimientos:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener movimientos",
    });
  }
};

// PUT /api/movimientos/:id
export const updateMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { fecha, concepto, monto, descripcion, prioridad, categoria_id, subcategoria_id, tipo } = req.body;

    // Validación
    if (!fecha || !concepto || monto === undefined) {
      return res.status(400).json({
        success: false,
        message: "Fecha, concepto y monto son requeridos",
      });
    }

    // Verificar que el movimiento existe
    const existingResult: any = await query(
      "SELECT id FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo'",
      [id],
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    // Actualizar movimiento
    const adjustedMonto = tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    await query(
      `UPDATE movimientos 
       SET fecha = ?, concepto = ?, monto = ?, descripcion = ?, prioridad = ?, categoria_id = ?, subcategoria_id = ?, tipo = ? 
       WHERE id = ? AND tipo_movimiento = 'efectivo'`,
      [fecha, concepto, adjustedMonto, descripcion || null, prioridad || "media", categoria_id || null, subcategoria_id || null, tipo || "ingreso", id],
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      `SELECT m.*, c.nombre as categoria_nombre, s.nombre as subcategoria_nombre 
       FROM movimientos m
       LEFT JOIN categorias c ON m.categoria_id = c.id
       LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
       WHERE m.id = ?`,
      [id],
    );

    res.json({
      success: true,
      message: "Movimiento actualizado exitosamente",
      data: updatedResult[0],
    });
  } catch (error) {
    console.error("Error al actualizar movimiento:", error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar movimiento",
    });
  }
};

// DELETE /api/movimientos/:id
export const deleteMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar que el movimiento existe
    const existingResult: any = await query(
      "SELECT id FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo'",
      [id],
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    // Eliminar movimiento (hard delete)
    await query("DELETE FROM movimientos WHERE id = ?", [id]);

    res.json({
      success: true,
      message: "Movimiento eliminado exitosamente",
    });
  } catch (error) {
    console.error("Error al eliminar movimiento:", error);
    res.status(500).json({
      success: false,
      message: "Error al eliminar movimiento",
    });
  }
};

// PUT /api/movimientos/:id/estado
export const updateEstadoMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    // Validación
    const estadosValidos = ["pendiente", "aprobado", "rechazado", "completado"];
    if (!estado || !estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message:
          "Estado inválido. Debe ser: pendiente, aprobado, rechazado o completado",
      });
    }

    // Verificar que el movimiento existe
    const existingResult: any = await query(
      "SELECT *, saldo as tipo_movimiento FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo'",
      [id],
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    const mov = existingResult[0];

    // Si cambia a pendiente y no lo era, lo enviamos a pagos pendientes
    if (mov.estado !== "pendiente" && estado === "pendiente") {
      await query(
        `UPDATE movimientos SET tipo_movimiento = 'pendiente', estado = 'pendiente', saldo = NULL WHERE id = ?`,
        [id]
      );

      return res.json({
        success: true,
        message: "Movimiento transferido a pagos pendientes exitosamente",
        data: { ...mov, estado: "pendiente", tipo_movimiento: "pendiente" },
      });
    }

    // Actualizar estado normalmente
    await query(
      "UPDATE movimientos SET estado = ? WHERE id = ?",
      [estado, id],
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: "Estado actualizado exitosamente",
      data: updatedResult[0],
    });
  } catch (error) {
    console.error("Error al actualizar estado:", error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar estado",
    });
  }
};

// POST /api/movimientos/efectivo
export const createMovimientoEfectivo = async (req: Request, res: Response) => {
  try {
    const {
      sucursal_id,
      user_id,
      fecha,
      concepto,
      descripcion,
      monto,
      prioridad,
      estado,
      categoria_id,
      subcategoria_id,
      tipo
    } = req.body;

    // Validación
    if (!sucursal_id || !user_id || !fecha || !concepto || monto === undefined) {
      return res.status(400).json({
        success: false,
        message:
          "Faltan campos requeridos: sucursal_id, user_id, fecha, concepto, monto",
      });
    }

    // Determinar saldo basado en el estado
    const estadoFinal = estado || "aprobado";
    const saldo = estadoFinal === "completado" ? "saldo_real" : "saldo_necesario";

    // Crear movimiento
    const adjustedMonto = tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    const result: any = await query(
      `INSERT INTO movimientos
       (sucursal_id, user_id, fecha, concepto, descripcion, monto, saldo, tipo_movimiento, prioridad, estado, categoria_id, subcategoria_id, tipo)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'efectivo', ?, ?, ?, ?, ?)`,
      [
        sucursal_id,
        user_id,
        fecha,
        concepto,
        descripcion || null,
        adjustedMonto,
        saldo,
        prioridad || "media",
        estadoFinal,
        categoria_id || null,
        subcategoria_id || null,
        tipo || "ingreso"
      ],
    );

    // Obtener el movimiento creado
    const createdMovimiento: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [result.insertId],
    );

    res.status(201).json({
      success: true,
      message: "Movimiento creado exitosamente",
      data: createdMovimiento[0],
    });
  } catch (error) {
    console.error("Error al crear movimiento:", error);
    res.status(500).json({
      success: false,
      message: "Error al crear movimiento",
    });
  }
};

// PUT /api/movimientos/efectivo/:id/mover-a-real
export const moverAReal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar que existe y está en saldo_necesario
    const movResult: any = await query(
      "SELECT *, saldo as tipo_movimiento FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo'",
      [id],
    );

    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    if (movResult[0].tipo_movimiento !== "saldo_necesario") {
      return res.status(400).json({
        success: false,
        message: "El movimiento no está en saldo necesario",
      });
    }

    // Mover a saldo real
    await query(
      `UPDATE movimientos 
       SET saldo = 'saldo_real', estado = 'completado' 
       WHERE id = ?`,
      [id],
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: "Movimiento movido a saldo real exitosamente",
      data: updatedResult[0],
    });
  } catch (error) {
    console.error("Error al mover movimiento:", error);
    res.status(500).json({
      success: false,
      message: "Error al mover movimiento",
    });
  }
};

// GET /api/movimientos/efectivo/:sucursalId/totales
export const getTotalesEfectivo = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;

    const result: any = await query(
      `SELECT 
        SUM(CASE WHEN estado = 'completado' THEN monto ELSE 0 END) as total_real,
        SUM(CASE WHEN estado = 'aprobado' THEN monto ELSE 0 END) as total_necesario,
        MAX(updated_at) as ultima_actualizacion
       FROM movimientos 
       WHERE sucursal_id = ? AND tipo_movimiento = 'efectivo'`,
      [sucursalId],
    );

    res.json({
      success: true,
      data: {
        total_real: result[0]?.total_real || 0,
        total_necesario: result[0]?.total_necesario || 0,
        ultima_actualizacion: result[0]?.ultima_actualizacion || null,
      },
    });
  } catch (error) {
    console.error("Error al obtener totales:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener totales",
    });
  }
};


// GET /api/caja-banco/:sucursalId
export const getMovimientosBancoBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;

    const result: any = await query(
      `SELECT m.id, m.sucursal_id, m.fecha, m.concepto, m.comprobante, m.monto, m.descripcion, m.prioridad, 
              m.saldo as tipo_movimiento, m.estado, m.numero_cheque, m.banco, m.cuenta, m.cbu, 
              m.tipo_operacion, m.tipo, m.categoria_id, m.subcategoria_id, m.banco_id, m.medio_pago_id,
              c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
              b.nombre as banco_nombre, mp.nombre as medio_pago_nombre,
              m.created_at, m.updated_at 
       FROM movimientos m
       LEFT JOIN categorias c ON m.categoria_id = c.id
       LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
       LEFT JOIN bancos b ON m.banco_id = b.id
       LEFT JOIN medios_pago mp ON m.medio_pago_id = mp.id
       WHERE m.sucursal_id = ? AND m.tipo_movimiento = 'banco'
       ORDER BY m.fecha DESC`,
      [sucursalId]
    );

    // Agrupar por tipo de movimiento (saldo real/necesario)
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
      user_id,
      fecha,
      concepto,
      comprobante,
      descripcion,
      monto,
      prioridad,
      estado,
      categoria_id,
      subcategoria_id,
      banco_id,
      medio_pago_id,
      numero_cheque,
      banco,
      cuenta,
      cbu,
      tipo_operacion,
      tipo
    } = req.body;

    // Validación
    if (!sucursal_id || !user_id || !fecha || !concepto || monto === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos: sucursal_id, user_id, fecha, concepto, monto'
      });
    }

    // Determinar saldo basado en el estado
    const estadoFinal = estado || "aprobado";
    const saldo = estadoFinal === "completado" ? "saldo_real" : "saldo_necesario";

    // Crear movimiento
    const adjustedMonto = tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    const result: any = await query(
      `INSERT INTO movimientos 
       (sucursal_id, user_id, fecha, concepto, comprobante, descripcion, monto, tipo_movimiento, saldo, prioridad,
        numero_cheque, banco, cuenta, cbu, tipo_operacion, estado, categoria_id, subcategoria_id, banco_id, medio_pago_id, tipo) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'banco', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sucursal_id, user_id, fecha, concepto, comprobante || null, descripcion || null, adjustedMonto, saldo,
        prioridad || 'media', numero_cheque || null, banco || null, cuenta || null,
        cbu || null, tipo_operacion || null, estadoFinal, categoria_id || null, subcategoria_id || null, banco_id || null, medio_pago_id || null, tipo || 'ingreso']
    );

    // Obtener el movimiento creado
    const createdMovimiento: any = await query(
      'SELECT * FROM movimientos WHERE id = ?',
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
      comprobante,
      monto,
      descripcion,
      prioridad,
      categoria_id,
      subcategoria_id,
      banco_id,
      medio_pago_id,
      numero_cheque,
      banco,
      cuenta,
      cbu,
      tipo_operacion,
      tipo
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
      "SELECT id FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'",
      [id]
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Movimiento no encontrado'
      });
    }

    // Actualizar
    const adjustedMonto = tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    await query(
      `UPDATE movimientos 
       SET fecha = ?, concepto = ?, comprobante = ?, monto = ?, descripcion = ?, prioridad = ?,
           numero_cheque = ?, banco = ?, cuenta = ?, cbu = ?, tipo_operacion = ?, tipo = ?,
           categoria_id = ?, subcategoria_id = ?, banco_id = ?, medio_pago_id = ?
       WHERE id = ? AND tipo_movimiento = 'banco'`,
      [fecha, concepto, comprobante || null, adjustedMonto, descripcion || null, prioridad || 'media',
        numero_cheque || null, banco || null, cuenta || null, cbu || null,
        tipo_operacion || null, tipo || 'ingreso', categoria_id || null, subcategoria_id || null, banco_id || null, medio_pago_id || null, id]
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      'SELECT * FROM movimientos WHERE id = ?',
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
      "SELECT id FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'",
      [id]
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Movimiento no encontrado'
      });
    }

    // Eliminar
    await query("DELETE FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'", [id]);

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
export const moverARealBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar que existe y está en saldo_necesario
    const movResult: any = await query(
      "SELECT *, saldo as tipo_movimiento FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'",
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
      `UPDATE movimientos 
       SET saldo = 'saldo_real', estado = 'completado' 
       WHERE id = ? AND tipo_movimiento = 'banco'`,
      [id]
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      'SELECT * FROM movimientos WHERE id = ?',
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
        SUM(CASE WHEN saldo = 'saldo_real' THEN monto ELSE 0 END) as total_real,
        SUM(CASE WHEN saldo = 'saldo_necesario' THEN monto ELSE 0 END) as total_necesario
       FROM movimientos 
       WHERE sucursal_id = ? AND tipo_movimiento = 'banco'`,
      [sucursalId]
    );

    const parcialesResult: any = await query(
      `SELECT 
        b.id as banco_id,
        b.nombre as banco_nombre,
        SUM(CASE WHEN m.saldo = 'saldo_real' THEN m.monto ELSE 0 END) as total_real,
        SUM(CASE WHEN m.saldo = 'saldo_necesario' THEN m.monto ELSE 0 END) as total_necesario
       FROM movimientos m
       LEFT JOIN bancos b ON m.banco_id = b.id
       WHERE m.sucursal_id = ? AND m.tipo_movimiento = 'banco'
       GROUP BY b.id, b.nombre`,
      [sucursalId]
    );

    res.json({
      success: true,
      data: {
        total_real: result[0]?.total_real || 0,
        total_necesario: result[0]?.total_necesario || 0,
        parciales: parcialesResult || []
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
      "SELECT *, saldo as tipo_movimiento FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'",
      [id]
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Movimiento no encontrado'
      });
    }

    const mov = existingResult[0];

    // Si cambia a pendiente y no lo era, se envía a pagos pendientes
    if (mov.estado !== 'pendiente' && estado === 'pendiente') {
      await query(
        `UPDATE movimientos SET tipo_movimiento = 'pendiente', estado = 'pendiente', saldo = NULL WHERE id = ?`,
        [id]
      );

      return res.json({
        success: true,
        message: 'Movimiento transferido a pagos pendientes exitosamente',
        data: { ...mov, estado: 'pendiente', tipo_movimiento: 'pendiente' }
      });
    }

    // Actualizar estado
    await query(
      "UPDATE movimientos SET estado = ? WHERE id = ? AND tipo_movimiento = 'banco'",
      [estado, id]
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      'SELECT * FROM movimientos WHERE id = ?',
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


// GET /api/pagos-pendientes/all
export const getAllPagosPendientes = async (req: Request, res: Response) => {
  try {
    const { estado } = req.query; // Filtro opcional por estado

    let sql = `
      SELECT 
        pp.*,
        pp.tipo,
        uc.nombre as usuario_creador_nombre,
        ur.nombre as usuario_revisor_nombre
      FROM movimientos pp
      LEFT JOIN usuarios uc ON pp.user_id = uc.id
      LEFT JOIN usuarios ur ON pp.usuario_revisor_id = ur.id
      WHERE pp.tipo_movimiento = 'pendiente'
    `;

    const params: any[] = [];

    if (estado) {
      sql += ' AND pp.estado = ?';
      params.push(estado);
    }

    sql += ' ORDER BY pp.fecha DESC';

    const result: any = await query(sql, params);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error al obtener todos los pagos pendientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener todos los pagos pendientes'
    });
  }
};

// GET /api/pagos-pendientes/:sucursalId
export const getPagosPendientesBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;
    const { estado } = req.query; // Filtro opcional por estado

    let sql = `
      SELECT 
        pp.*,
        pp.tipo,
        uc.nombre as usuario_creador_nombre,
        ur.nombre as usuario_revisor_nombre
      FROM movimientos pp
      LEFT JOIN usuarios uc ON pp.user_id = uc.id
      LEFT JOIN usuarios ur ON pp.usuario_revisor_id = ur.id
      WHERE pp.sucursal_id = ? AND pp.tipo_movimiento = 'pendiente'
    `;

    const params: any[] = [sucursalId];

    if (estado) {
      sql += ' AND pp.estado = ?';
      params.push(estado);
    }

    sql += ' ORDER BY pp.fecha DESC';

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
      user_id,
      fecha,
      concepto,
      descripcion,
      monto,
      tipo_movimiento,
      prioridad,
      tipo
    } = req.body;

    // Validación
    if (!sucursal_id || !user_id || !fecha || !concepto || monto === undefined || !tipo_movimiento) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos'
      });
    }

    // Crear pago pendiente
    const adjustedMonto = tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    const result: any = await query(
      `INSERT INTO movimientos 
             (sucursal_id, user_id, fecha, concepto, descripcion, monto, tipo_movimiento, prioridad, estado, tipo) 
             VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?, 'pendiente', ?)`,
      [sucursal_id, user_id, fecha, concepto, descripcion || null, adjustedMonto, prioridad || 'media', tipo || 'egreso']
    );

    // Obtener el pago creado
    const createdPago: any = await query(
      "SELECT * FROM movimientos WHERE id = ? AND tipo_movimiento = 'pendiente'",
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
      "SELECT * FROM movimientos WHERE id = ? AND tipo_movimiento = 'pendiente'",
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

    // Determinar destino
    const { tipo_caja } = req.body;
    const newTipoMovimiento = (tipo_caja === 'efectivo' || !tipo_caja) ? 'efectivo' : 'banco';

    // Actualizar estado del pago pendiente: lo pasamos a la caja respectiva
    await query(
      `UPDATE movimientos 
             SET estado = 'aprobado', usuario_revisor_id = ?, tipo_movimiento = ?, saldo = 'saldo_necesario'
             WHERE id = ?`,
      [usuario_revisor_id, newTipoMovimiento, id]
    );

    // Obtener el pago actualizado
    const updatedPago: any = await query(
      'SELECT * FROM movimientos WHERE id = ?',
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
      "SELECT * FROM movimientos WHERE id = ? AND tipo_movimiento = 'pendiente'",
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
      `UPDATE movimientos 
       SET estado = 'rechazado', usuario_revisor_id = ?, motivo_rechazo = ?
       WHERE id = ? AND tipo_movimiento = 'pendiente'`,
      [usuario_revisor_id, motivo_rechazo, id]
    );

    // Obtener el pago actualizado
    const updatedPago: any = await query(
      "SELECT * FROM movimientos WHERE id = ? AND tipo_movimiento = 'pendiente'",
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
      "SELECT * FROM movimientos WHERE id = ? AND tipo_movimiento = 'pendiente'",
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
    await query("DELETE FROM movimientos WHERE id = ? AND tipo_movimiento = 'pendiente'", [id]);

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
