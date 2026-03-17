import { Request, Response } from "express";
import { query } from "../config/database";

// GET /api/movimientos/:sucursalId
export const getMovimientosBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;
    const moneda = (req.query.moneda as string) || 'ARS';

    // Obtener todos los movimientos de la sucursal
    const result: any = await query(
      `SELECT m.id, m.sucursal_id, m.fecha, m.concepto, m.monto, m.descripcion, m.prioridad, 
              m.saldo as tipo_movimiento, m.estado, m.categoria_id, m.subcategoria_id, 
              m.tipo, m.es_deuda, m.fecha_original_vencimiento,
              m.moneda, m.tipo_cambio,
              c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
              m.created_at, m.updated_at 
       FROM movimientos m
       LEFT JOIN categorias c ON m.categoria_id = c.id
       LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
       WHERE m.sucursal_id = ? AND m.tipo_movimiento = 'efectivo' AND m.moneda = ?
       ORDER BY m.fecha DESC`,
      [sucursalId, moneda],
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
    const {
      fecha,
      concepto,
      monto,
      descripcion,
      prioridad,
      categoria_id,
      subcategoria_id,
      tipo,
    } = req.body;

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
    const adjustedMonto =
      tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    await query(
      `UPDATE movimientos 
       SET fecha = ?, concepto = ?, monto = ?, descripcion = ?, prioridad = ?, categoria_id = ?, subcategoria_id = ?, tipo = ? 
       WHERE id = ? AND tipo_movimiento = 'efectivo'`,
      [
        fecha,
        concepto,
        adjustedMonto,
        descripcion || null,
        prioridad || "media",
        categoria_id || null,
        subcategoria_id || null,
        tipo || "ingreso",
        id,
      ],
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

    // Si cambia a pendiente
    if (mov.estado !== "pendiente" && estado === "pendiente") {
      await query(
        `UPDATE movimientos SET estado = 'pendiente', saldo = 'saldo_necesario' WHERE id = ?`,
        [id],
      );

      return res.json({
        success: true,
        message: "Movimiento marcado como pendiente exitosamente",
        data: { ...mov, estado: "pendiente" },
      });
    }

    // Actualizar estado normalmente
    await query("UPDATE movimientos SET estado = ? WHERE id = ?", [estado, id]);

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
      tipo,
      moneda,
      tipo_cambio,
    } = req.body;

    // Validación
    if (
      !sucursal_id ||
      !user_id ||
      !fecha ||
      !concepto ||
      monto === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Faltan campos requeridos: sucursal_id, user_id, fecha, concepto, monto",
      });
    }

    // Determinar saldo basado en el estado
    const estadoFinal = estado || "aprobado";
    const saldo =
      estadoFinal === "completado" ? "saldo_real" : "saldo_necesario";

    // Crear movimiento
    const adjustedMonto =
      tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    const monedaFinal = moneda || 'ARS';
    const tipoCambioFinal = monedaFinal === 'USD' ? (tipo_cambio || null) : null;

    const result: any = await query(
      `INSERT INTO movimientos
       (sucursal_id, user_id, fecha, concepto, descripcion, monto, saldo, tipo_movimiento, prioridad, estado, categoria_id, subcategoria_id, tipo, moneda, tipo_cambio)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'efectivo', ?, ?, ?, ?, ?, ?, ?)`,
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
        tipo || "ingreso",
        monedaFinal,
        tipoCambioFinal,
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

// PUT /api/movimientos/:id/deuda
export const toggleDeudaEfectivo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { es_deuda, fecha_original_vencimiento } = req.body;

    if (es_deuda === undefined || (es_deuda !== 0 && es_deuda !== 1)) {
      return res.status(400).json({
        success: false,
        message: "es_deuda debe ser 0 o 1",
      });
    }

    // Verificar que el movimiento existe
    const movResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ? AND tipo_movimiento = 'efectivo'",
      [id],
    );

    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    const mov = movResult[0];

    if (es_deuda === 1) {
      // Activar deuda: guardar fecha original de vencimiento
      await query(
        `UPDATE movimientos SET es_deuda = 1, fecha_original_vencimiento = ? WHERE id = ? AND tipo_movimiento = 'efectivo'`,
        [fecha_original_vencimiento || mov.fecha, id],
      );
    } else {
      // 1. Mantenemos la deuda original intacta históricamente, pero la pasamos a "completado"
      await query(
        `UPDATE movimientos SET estado = 'completado' WHERE id = ? AND tipo_movimiento = 'efectivo'`,
        [id],
      );

      // 2. Clonamos este registro como un Egreso en el día de la fecha (Pago real)
      const fechaOriginal = mov.fecha_original_vencimiento || mov.fecha;
      let nuevaDescripcion = mov.descripcion || "";
      if (fechaOriginal) {
        const partes = fechaOriginal.toString().split("T")[0].split("-");
        const fechaFormateada = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : fechaOriginal;
        const nota = `[Pago de deuda original del: ${fechaFormateada}]`;
        nuevaDescripcion = nuevaDescripcion
          ? `${nuevaDescripcion} ${nota}`
          : nota;
      }
      
      const fechaPago = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const adjustedMonto = -Math.abs(mov.monto); // Aseguramos que sea egreso en caja
      
      await query(
        `INSERT INTO movimientos 
         (sucursal_id, user_id, fecha, concepto, comprobante, descripcion, monto, tipo_movimiento, saldo, prioridad,
          numero_cheque, banco, cuenta, cbu, tipo_operacion, estado, categoria_id, subcategoria_id, banco_id, medio_pago_id, tipo,
          es_deuda, fecha_original_vencimiento, moneda, tipo_cambio) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 'efectivo', ?, ?, ?, ?, ?, ?, ?, 'completado', ?, ?, ?, ?, 'egreso', 0, NULL, ?, ?)`,
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
          mov.banco_id,
          mov.medio_pago_id,
          mov.moneda || 'ARS',
          mov.moneda === 'USD' ? (mov.tipo_cambio || null) : null
        ],
      );
    }

    const updatedResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: es_deuda === 1 ? "Deuda activada exitosamente" : "Deuda desactivada exitosamente",
      data: updatedResult[0],
    });
  } catch (error) {
    console.error("Error al actualizar deuda (efectivo):", error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar estado de deuda",
    });
  }
};

// GET /api/movimientos/efectivo/:sucursalId/totales
export const getTotalesEfectivo = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;
    const moneda = (req.query.moneda as string) || 'ARS';

    const result: any = await query(
      `SELECT 
        SUM(CASE WHEN estado = 'completado' THEN monto ELSE 0 END) as total_real,
        SUM(CASE WHEN estado = 'aprobado' AND (es_deuda = 0 OR es_deuda IS NULL) THEN monto ELSE 0 END) as total_necesario,
        MAX(updated_at) as ultima_actualizacion
       FROM movimientos 
       WHERE sucursal_id = ? AND tipo_movimiento = 'efectivo' AND moneda = ?`,
      [sucursalId, moneda],
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
export const getMovimientosBancoBySucursal = async (
  req: Request,
  res: Response,
) => {
  try {
    const { sucursalId } = req.params;
    const moneda = (req.query.moneda as string) || 'ARS';

    const result: any = await query(
      `SELECT m.id, m.sucursal_id, m.fecha, m.concepto, m.comprobante, m.monto, m.descripcion, m.prioridad, 
              m.saldo as tipo_movimiento, m.estado, m.numero_cheque, m.banco, m.cuenta, m.cbu, 
              m.tipo_operacion, m.tipo, m.categoria_id, m.subcategoria_id, m.banco_id, m.medio_pago_id,
              m.es_deuda, m.fecha_original_vencimiento,
              m.moneda, m.tipo_cambio,
              c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
              b.nombre as banco_nombre, mp.nombre as medio_pago_nombre,
              m.created_at, m.updated_at 
       FROM movimientos m
       LEFT JOIN categorias c ON m.categoria_id = c.id
       LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
       LEFT JOIN bancos b ON m.banco_id = b.id
       LEFT JOIN medios_pago mp ON m.medio_pago_id = mp.id
       WHERE m.sucursal_id = ? AND m.tipo_movimiento = 'banco' AND m.moneda = ?
       ORDER BY m.fecha DESC`,
      [sucursalId, moneda],
    );

    // Agrupar por tipo de movimiento (saldo real/necesario)
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
    console.error("Error al obtener movimientos banco:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener movimientos banco",
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
      tipo,
      moneda,
      tipo_cambio,
    } = req.body;

    // Validación
    if (
      !sucursal_id ||
      !user_id ||
      !fecha ||
      !concepto ||
      monto === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Faltan campos requeridos: sucursal_id, user_id, fecha, concepto, monto",
      });
    }

    // Determinar saldo basado en el estado
    const estadoFinal = estado || "aprobado";
    const saldo =
      estadoFinal === "completado" ? "saldo_real" : "saldo_necesario";

    // Crear movimiento
    const adjustedMonto =
      tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    const monedaFinal = moneda || 'ARS';
    const tipoCambioFinal = monedaFinal === 'USD' ? (tipo_cambio || null) : null;

    const result: any = await query(
      `INSERT INTO movimientos 
       (sucursal_id, user_id, fecha, concepto, comprobante, descripcion, monto, tipo_movimiento, saldo, prioridad,
        numero_cheque, banco, cuenta, cbu, tipo_operacion, estado, categoria_id, subcategoria_id, banco_id, medio_pago_id, tipo, moneda, tipo_cambio) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'banco', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sucursal_id,
        user_id,
        fecha,
        concepto,
        comprobante || null,
        descripcion || null,
        adjustedMonto,
        saldo,
        prioridad || "media",
        numero_cheque || null,
        banco || null,
        cuenta || null,
        cbu || null,
        tipo_operacion || null,
        estadoFinal,
        categoria_id || null,
        subcategoria_id || null,
        banco_id || null,
        medio_pago_id || null,
        tipo || "ingreso",
        monedaFinal,
        tipoCambioFinal,
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
    console.error("Error al crear movimiento banco:", error);
    res.status(500).json({
      success: false,
      message: "Error al crear movimiento banco",
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
      tipo,
    } = req.body;

    // Validación
    if (!fecha || !concepto || monto === undefined) {
      return res.status(400).json({
        success: false,
        message: "Fecha, concepto y monto son requeridos",
      });
    }

    // Verificar que existe
    const existingResult: any = await query(
      "SELECT id FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'",
      [id],
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    // Actualizar
    const adjustedMonto =
      tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    await query(
      `UPDATE movimientos 
       SET fecha = ?, concepto = ?, comprobante = ?, monto = ?, descripcion = ?, prioridad = ?,
           numero_cheque = ?, banco = ?, cuenta = ?, cbu = ?, tipo_operacion = ?, tipo = ?,
           categoria_id = ?, subcategoria_id = ?, banco_id = ?, medio_pago_id = ?
       WHERE id = ? AND tipo_movimiento = 'banco'`,
      [
        fecha,
        concepto,
        comprobante || null,
        adjustedMonto,
        descripcion || null,
        prioridad || "media",
        numero_cheque || null,
        banco || null,
        cuenta || null,
        cbu || null,
        tipo_operacion || null,
        tipo || "ingreso",
        categoria_id || null,
        subcategoria_id || null,
        banco_id || null,
        medio_pago_id || null,
        id,
      ],
    );

    // Obtener el movimiento actualizado
    const updatedResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: "Movimiento actualizado exitosamente",
      data: updatedResult[0],
    });
  } catch (error) {
    console.error("Error al actualizar movimiento banco:", error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar movimiento banco",
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
      [id],
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    // Eliminar
    await query(
      "DELETE FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'",
      [id],
    );

    res.json({
      success: true,
      message: "Movimiento eliminado exitosamente",
    });
  } catch (error) {
    console.error("Error al eliminar movimiento banco:", error);
    res.status(500).json({
      success: false,
      message: "Error al eliminar movimiento banco",
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
       WHERE id = ? AND tipo_movimiento = 'banco'`,
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

// PUT /api/caja-banco/:id/deuda
export const toggleDeudaBanco = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { es_deuda, fecha_original_vencimiento } = req.body;

    if (es_deuda === undefined || (es_deuda !== 0 && es_deuda !== 1)) {
      return res.status(400).json({
        success: false,
        message: "es_deuda debe ser 0 o 1",
      });
    }

    // Verificar que el movimiento existe
    const movResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'",
      [id],
    );

    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    const mov = movResult[0];

    if (es_deuda === 1) {
      // Activar deuda
      await query(
        `UPDATE movimientos SET es_deuda = 1, fecha_original_vencimiento = ? WHERE id = ? AND tipo_movimiento = 'banco'`,
        [fecha_original_vencimiento || mov.fecha, id],
      );
    } else {
      // 1. Mantenemos la deuda original intacta históricamente, pero la pasamos a "completado"
      await query(
        `UPDATE movimientos SET estado = 'completado' WHERE id = ? AND tipo_movimiento = 'banco'`,
        [id],
      );

      // 2. Clonamos este registro como un Egreso en el día de la fecha (Pago real)
      const fechaOriginal = mov.fecha_original_vencimiento || mov.fecha;
      let nuevaDescripcion = mov.descripcion || "";
      if (fechaOriginal) {
        const partes = fechaOriginal.toString().split("T")[0].split("-");
        const fechaFormateada = partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : fechaOriginal;
        const nota = `[Pago de deuda original del: ${fechaFormateada}]`;
        nuevaDescripcion = nuevaDescripcion
          ? `${nuevaDescripcion} ${nota}`
          : nota;
      }

      const fechaPago = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const adjustedMonto = -Math.abs(mov.monto); // Aseguramos que sea egreso en banco

      await query(
        `INSERT INTO movimientos 
         (sucursal_id, user_id, fecha, concepto, comprobante, descripcion, monto, tipo_movimiento, saldo, prioridad,
          numero_cheque, banco, cuenta, cbu, tipo_operacion, estado, categoria_id, subcategoria_id, banco_id, medio_pago_id, tipo,
          es_deuda, fecha_original_vencimiento, moneda, tipo_cambio) 
         VALUES (?, ?, ?, ?, ?, ?, ?, 'banco', ?, ?, ?, ?, ?, ?, ?, 'completado', ?, ?, ?, ?, 'egreso', 0, NULL, ?, ?)`,
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
          mov.banco_id,
          mov.medio_pago_id,
          mov.moneda || 'ARS',
          mov.moneda === 'USD' ? (mov.tipo_cambio || null) : null
        ],
      );
    }

    const updatedResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: es_deuda === 1 ? "Deuda activada exitosamente" : "Deuda desactivada exitosamente",
      data: updatedResult[0],
    });
  } catch (error) {
    console.error("Error al actualizar deuda (banco):", error);
    res.status(500).json({
      success: false,
      message: "Error al actualizar estado de deuda",
    });
  }
};

// GET /api/caja-banco/:sucursalId/totales
export const getTotalesBanco = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;
    const moneda = (req.query.moneda as string) || 'ARS';

    const result: any = await query(
      `SELECT 
        SUM(CASE WHEN estado = 'completado' THEN monto ELSE 0 END) as total_real,
        SUM(CASE WHEN estado IN ('aprobado', 'pendiente') AND (es_deuda = 0 OR es_deuda IS NULL) THEN monto ELSE 0 END) as total_necesario
       FROM movimientos 
       WHERE sucursal_id = ? AND tipo_movimiento = 'banco' AND moneda = ?`,
      [sucursalId, moneda],
    );

    const parcialesResult: any = await query(
      `SELECT 
        b.id as banco_id,
        b.nombre as banco_nombre,
        SUM(CASE WHEN m.estado = 'completado' THEN m.monto ELSE 0 END) as total_real,
        SUM(CASE WHEN m.estado IN ('aprobado', 'pendiente') AND (m.es_deuda = 0 OR m.es_deuda IS NULL) THEN m.monto ELSE 0 END) as total_necesario
       FROM movimientos m
       LEFT JOIN bancos b ON m.banco_id = b.id
       WHERE m.sucursal_id = ? AND m.tipo_movimiento = 'banco' AND m.moneda = ?
       GROUP BY b.id, b.nombre`,
      [sucursalId, moneda],
    );

    res.json({
      success: true,
      data: {
        total_real: result[0]?.total_real || 0,
        total_necesario: result[0]?.total_necesario || 0,
        parciales: parcialesResult || [],
      },
    });
  } catch (error) {
    console.error("Error al obtener totales banco:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener totales banco",
    });
  }
};

// PUT /api/caja-banco/:id/estado
export const updateEstadoMovimientoBanco = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    // Validación
    const estadosValidos = ["pendiente", "aprobado", "rechazado", "completado"];
    if (!estado || !estadosValidos.includes(estado)) {
      return res.status(400).json({
        success: false,
        message: "Estado inválido",
      });
    }

    // Verificar que existe
    const existingResult: any = await query(
      "SELECT *, saldo as tipo_movimiento FROM movimientos WHERE id = ? AND tipo_movimiento = 'banco'",
      [id],
    );

    if (!Array.isArray(existingResult) || existingResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    const mov = existingResult[0];

    // Si cambia a pendiente
    if (mov.estado !== "pendiente" && estado === "pendiente") {
      await query(
        `UPDATE movimientos SET estado = 'pendiente', saldo = 'saldo_necesario' WHERE id = ? AND tipo_movimiento = 'banco'`,
        [id],
      );

      return res.json({
        success: true,
        message: "Movimiento marcado como pendiente exitosamente",
        data: { ...mov, estado: "pendiente" },
      });
    }

    // Actualizar estado
    await query(
      "UPDATE movimientos SET estado = ? WHERE id = ? AND tipo_movimiento = 'banco'",
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

// GET /api/pagos-pendientes/all
export const getAllPagosPendientes = async (req: Request, res: Response) => {
  try {
    const { estado, moneda } = req.query; // Filtro opcional por estado y moneda

    let sql = `
      SELECT 
        pp.*,
        pp.tipo,
        uc.nombre as usuario_creador_nombre,
        ur.nombre as usuario_revisor_nombre
      FROM movimientos pp
      LEFT JOIN usuarios uc ON pp.user_id = uc.id
      LEFT JOIN usuarios ur ON pp.usuario_revisor_id = ur.id
      WHERE pp.estado = 'pendiente' AND (pp.tipo = 'egreso' OR pp.tipo IS NULL)
    `;

    const params: any[] = [];

    /**
     * Comentado porque ahora la query ya trae SOLO los que tienen pp.estado = 'pendiente'
     * Si necesitas filtrar por OTRO estado en el futuro, habría que reestructurarlo.
    if (estado) {
      sql += " AND pp.estado = ?";
      params.push(estado);
    }
    */

    if (moneda) {
      sql += " AND pp.moneda = ?";
      params.push(moneda);
    }

    sql += " ORDER BY pp.fecha DESC";

    const result: any = await query(sql, params);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error al obtener todos los pagos pendientes:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener todos los pagos pendientes",
    });
  }
};

// GET /api/pagos-pendientes/:sucursalId
export const getPagosPendientesBySucursal = async (
  req: Request,
  res: Response,
) => {
  try {
    const { sucursalId } = req.params;
    const { estado, moneda } = req.query; // Filtro opcional por estado y moneda

    let sql = `
      SELECT 
        pp.*,
        pp.tipo,
        uc.nombre as usuario_creador_nombre,
        ur.nombre as usuario_revisor_nombre
      FROM movimientos pp
      LEFT JOIN usuarios uc ON pp.user_id = uc.id
      LEFT JOIN usuarios ur ON pp.usuario_revisor_id = ur.id
      WHERE pp.sucursal_id = ? AND pp.estado = 'pendiente' AND (pp.tipo = 'egreso' OR pp.tipo IS NULL)
    `;

    const params: any[] = [sucursalId];

    /**
     * Comentado porque la base de la query ya trae los que son estado='pendiente'
    if (estado) {
      sql += " AND pp.estado = ?";
      params.push(estado);
    }
    */

    if (moneda) {
      sql += " AND pp.moneda = ?";
      params.push(moneda);
    }

    sql += " ORDER BY pp.fecha DESC";

    const result: any = await query(sql, params);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error al obtener pagos pendientes:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener pagos pendientes",
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
      tipo,
    } = req.body;

    // Validación
    if (
      !sucursal_id ||
      !user_id ||
      !fecha ||
      !concepto ||
      monto === undefined ||
      !tipo_movimiento
    ) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos requeridos",
      });
    }

    const destinoCaja = tipo_movimiento === "banco" ? "banco" : "efectivo";

    // Crear pago pendiente (usando el estado 'pendiente' y el tipo de caja)
    const adjustedMonto =
      tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);

    const result: any = await query(
      `INSERT INTO movimientos 
             (sucursal_id, user_id, fecha, concepto, descripcion, monto, tipo_movimiento, saldo, prioridad, estado, tipo) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'saldo_necesario', ?, 'pendiente', ?)`,
      [
        sucursal_id,
        user_id,
        fecha,
        concepto,
        descripcion || null,
        adjustedMonto,
        destinoCaja,
        prioridad || "media",
        tipo || "egreso",
      ],
    );

    // Obtener el pago creado
    const createdPago: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [result.insertId],
    );

    res.status(201).json({
      success: true,
      message: "Pago pendiente creado exitosamente",
      data: createdPago[0],
    });
  } catch (error) {
    console.error("Error al crear pago pendiente:", error);
    res.status(500).json({
      success: false,
      message: "Error al crear pago pendiente",
    });
  }
};

// PUT /api/pagos-pendientes/:id/aprobar
export const aprobarPagoPendiente = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { usuario_revisor_id, tipo_caja, fecha, banco_id, medio_pago_id } = req.body;

    // Validación
    if (!usuario_revisor_id) {
      return res.status(400).json({
        success: false,
        message: "ID de usuario revisor es requerido",
      });
    }

    // Obtener el pago pendiente
    const pagoResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    if (!Array.isArray(pagoResult) || pagoResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Pago pendiente no encontrado",
      });
    }

    const pago = pagoResult[0];

    // Verificar que esté pendiente
    if (pago.estado !== "pendiente") {
      return res.status(400).json({
        success: false,
        message: "El pago ya fue procesado",
      });
    }

    // Determinar destino (se asume que si el body mandó tipo_caja, se prioriza)
    let newTipoMovimiento = pago.tipo_movimiento;
    if (tipo_caja) {
      newTipoMovimiento = tipo_caja === "efectivo" ? "efectivo" : "banco";
    }

    // Verificar si la fecha fue modificada
    let nuevaDescripcion = pago.descripcion || "";
    if (fecha && pago.fecha) {
      // pago.fecha puede ser un Date object desde la BD
      const fechaOriginal = new Date(pago.fecha).toISOString().split('T')[0];
      if (fechaOriginal !== fecha) {
        const partsOriginal = fechaOriginal.split('-');
        const fechaOriginalFormat = `${partsOriginal[2]}/${partsOriginal[1]}/${partsOriginal[0]}`;
        const partsNueva = fecha.split('-');
        const fechaNuevaFormat = `${partsNueva[2]}/${partsNueva[1]}/${partsNueva[0]}`;
        
        const nota = `\n[Nota del sistema: El administrador modificó la fecha de pago de ${fechaOriginalFormat} a ${fechaNuevaFormat}]`;
        nuevaDescripcion = nuevaDescripcion ? `${nuevaDescripcion}${nota}` : nota;
      }
    }

    // Actualizar estado del pago pendiente: lo pasamos a aprobado y confirmamos la caja
    await query(
      `UPDATE movimientos 
             SET estado = 'aprobado', usuario_revisor_id = ?, tipo_movimiento = ?, saldo = 'saldo_necesario',
             fecha = COALESCE(?, fecha), banco_id = ?, medio_pago_id = ?, descripcion = ?
             WHERE id = ?`,
      [usuario_revisor_id, newTipoMovimiento, fecha || null, banco_id || null, medio_pago_id || null, nuevaDescripcion, id],
    );

    // Obtener el pago actualizado
    const updatedPago: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: "Pago aprobado y programado exitosamente",
      data: updatedPago[0],
    });
  } catch (error) {
    console.error("Error al aprobar pago:", error);
    res.status(500).json({
      success: false,
      message: "Error al aprobar pago",
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
        message: "Usuario revisor y motivo de rechazo son requeridos",
      });
    }

    // Verificar que el pago existe y está pendiente
    const pagoResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    if (!Array.isArray(pagoResult) || pagoResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Pago pendiente no encontrado",
      });
    }

    if (pagoResult[0].estado !== "pendiente") {
      return res.status(400).json({
        success: false,
        message: "El pago ya fue procesado",
      });
    }

    // Actualizar estado
    await query(
      `UPDATE movimientos 
       SET estado = 'rechazado', usuario_revisor_id = ?, motivo_rechazo = ?
       WHERE id = ?`,
      [usuario_revisor_id, motivo_rechazo, id],
    );

    // Obtener el pago actualizado
    const updatedPago: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: "Pago rechazado exitosamente",
      data: updatedPago[0],
    });
  } catch (error) {
    console.error("Error al rechazar pago:", error);
    res.status(500).json({
      success: false,
      message: "Error al rechazar pago",
    });
  }
};

// DELETE /api/pagos-pendientes/:id
export const deletePagoPendiente = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar que existe
    const pagoResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    if (!Array.isArray(pagoResult) || pagoResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Pago pendiente no encontrado",
      });
    }

    // Solo se puede eliminar si está pendiente
    if (pagoResult[0].estado !== "pendiente") {
      return res.status(400).json({
        success: false,
        message: "Solo se pueden eliminar pagos pendientes",
      });
    }

    // Eliminar
    await query("DELETE FROM movimientos WHERE id = ?", [id]);

    res.json({
      success: true,
      message: "Pago pendiente eliminado exitosamente",
    });
  } catch (error) {
    console.error("Error al eliminar pago pendiente:", error);
    res.status(500).json({
      success: false,
      message: "Error al eliminar pago pendiente",
    });
  }
};
// GET /api/pagos-pendientes/historial/:userId
export const getHistorialByUser = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { sucursal_id, moneda } = req.query;

    const userResult: any = await query("SELECT r.nombre as rol FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id WHERE u.id = ?", [userId]);
    const rol = userResult && userResult.length > 0 ? userResult[0].rol : "empleado";

    let sql = `
      SELECT 
        m.*,
        uc.nombre as usuario_creador_nombre,
        ur.nombre as usuario_revisor_nombre
      FROM movimientos m
      LEFT JOIN usuarios uc ON m.user_id = uc.id
      LEFT JOIN usuarios ur ON m.usuario_revisor_id = ur.id
      WHERE m.estado IN ('aprobado', 'rechazado', 'completado')
        AND (m.tipo = 'egreso' OR m.tipo IS NULL)
    `;

    const queryParams: any[] = [];

    if (rol !== "admin") {
      sql += " AND m.user_id = ?";
      queryParams.push(userId);
    }

    if (sucursal_id) {
      sql += " AND m.sucursal_id = ?";
      queryParams.push(sucursal_id);
    }

    if (moneda) {
      sql += " AND m.moneda = ?";
      queryParams.push(moneda);
    }

    sql += " ORDER BY m.fecha DESC, m.created_at DESC";

    const result: any = await query(sql, queryParams);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error al obtener historial de pagos pendientes:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener historial",
    });
  }
};

// PUT /api/movimientos/:id/mover
export const moverMovimiento = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
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
    } = req.body;

    // Validación básica
    if (!destino_tipo_movimiento || !destino_saldo || !destino_sucursal_id) {
      return res.status(400).json({
        success: false,
        message: "Faltan datos de destino obligatorios.",
      });
    }

    // Verificar que el movimiento existe
    const movResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    if (!Array.isArray(movResult) || movResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Movimiento no encontrado",
      });
    }

    const mov = movResult[0];

    const isDifferentSucursal = String(mov.sucursal_id) !== String(destino_sucursal_id);
    const createDebts = es_credito && isDifferentSucursal;

    // Preparar campos a actualizar
    let nuevaDescripcion = mov.descripcion || "";
    if (nota_descripcion) {
      // Limpiar notas de movimiento previas para evitar un "choclo" de texto acumulado
      const separador = "\n📌 Nota interna: ";
      if (nuevaDescripcion.includes(separador)) {
        nuevaDescripcion = nuevaDescripcion.split(separador)[0].trim();
      }

      nuevaDescripcion = nuevaDescripcion
        ? `${nuevaDescripcion}${separador}${nota_descripcion}`
        : `${nota_descripcion}`;
    }
    
    // Si es crédito, invertimos el tipo para la sucursal de destino.
    // Ej: Si era egreso en origen, ingresa a destino.
    let nuevoTipo = mov.tipo;
    if (createDebts) {
      nuevoTipo = mov.tipo === "ingreso" ? "egreso" : "ingreso";
    }

    const nuevoEstado = destino_saldo === "saldo_real" ? "completado" : "aprobado";

    if (createDebts) {
      // SI ES CRÉDITO: EL REGISTRO ORIGINAL NO SE "MUEVE" SINO QUE SE CLONA/COMPENSA.
      // 1. El registro original (ingreso/egreso) se queda en la sucursal origen.
      // Pero si era un INGRESO que movemos, significa que estamos mandando esa plata a otra lado, 
      //  -> El registro en origen se convierte en EGRESO (salió la plata).
      //  -> El registro en destino será INGRESO (entró la plata).
      // Si era un EGRESO que movemos (estamos asumiendo un gasto de otra sucursal),
      //  -> El origen asume el gasto: se queda como EGRESO.
      //  -> El destino recibe el beneficio: ingresa dinero ficticio para compensar? (esto lo detalla luego el user)
      // ASUMIENDO REGLAS BÁSICAS SEGÚN CONTEXTO DEL USUARIO:
      let tipoOrigenActualizado: "ingreso" | "egreso" = "egreso";
      let tipoDestinoReal: "ingreso" | "egreso" = "ingreso";
      let tipoOrigenDeuda: "ingreso" | "egreso" = "ingreso";
      let tipoDestinoDeuda: "ingreso" | "egreso" = "egreso";

      if (mov.tipo === "ingreso") {
        // CASO 1: MUEVO UN INGRESO (plata que tengo) a otra sucursal
        // Salió plata real mía (egreso) -> Entra plata real al destino (ingreso).
        tipoOrigenActualizado = "egreso";
        tipoDestinoReal = "ingreso";
        // Origen asume ingreso a futuro (A Cobrar / deuda a favor)
        tipoOrigenDeuda = "ingreso";
        // Destino asume egreso a futuro (A Pagar / deuda en contra)
        tipoDestinoDeuda = "egreso";
      } else {
        // CASO 2: MUEVO UN EGRESO (un gasto ajeno que pagué yo) a otra sucursal
        // El Origen asume el "Mover" como que ese gasto ya se delegó (el registro queda como Egreso, pero la deuda será distinta).
        // Actualizamos origen (queda el egreso real).
        tipoOrigenActualizado = "egreso";
        
        // El Destino asume el consumo (Egreso Real).
        tipoDestinoReal = "egreso";
        
        // El Origen (que garpó) ahora tiene una Deuda A FAVOR (Ingreso futuro).
        tipoOrigenDeuda = "ingreso";
        // El Destino (el gastador original) tiene una Deuda EN CONTRA (Egreso que debe compensar, aunque el user pidió Deuda en contra).
        // Aclaración del User: "..crear la deuda a favor (para nosotros, origen) y en contra (para destino)".
        // Wait, review user's message:
        // "En la caja origen.. se genera.. un registro como DEUDA (el cual actualmente lo esta creando, pero positivo, cuando deberia ser negativo) en el saldo necesario."
        // Let's re-read the prompt exactly for EGRESO.
        // Origen: Muevo egreso -> el registro se va?. "Lo unico que tiene que hacer es mover el consumo a la sucursal destino, y generar un registro como DEUDA... en negativo"
        // Destino: "Crear el registro que me enviaron para pagar (negativo). .. Ademas debo crear un registro extra como deuda a favor (positivo) porque en algun momento vamos a cobrar.."
        
        // Ok, inverted roles completely requested by user for EGRESO:
        // ORIGEN: NO hay registro real, se MUEVE al destino literal. Pero queda la DEUDA EN CONTRA (egreso). "generar un registro como DEUDA (negativo) en necesario".
        // DESTINO: Obtiene el consumo real (egreso), Y ADEMÁS obtiene una deuda a favor (ingreso). "Ademas debo crear un registro extra como deuda a favor (positivo)".
      }

      // We need to implement this branching fully above the UPDATE/INSERTs.
      const getSignedMonto = (t: string, m: number) => t === 'egreso' ? -Math.abs(m) : Math.abs(m);

      if (mov.tipo === "ingreso") {
        // --- CASO 1: MUEVO UN INGRESO ---
        const tipoOrigenActualizado = "egreso";
        const tipoDestinoReal       = "ingreso";
        const tipoOrigenDeuda       = "ingreso";
        const tipoDestinoDeuda      = "egreso";

        // Actualizamos el registro original en su MISMA sucursal para que refleje la salida real del dinero
        await query(
          `UPDATE movimientos 
           SET tipo = ?, estado = ?, descripcion = ?, monto = ?
           WHERE id = ?`,
          [tipoOrigenActualizado, "completado", nuevaDescripcion, getSignedMonto(tipoOrigenActualizado, mov.monto), id],
        );

        // Creamos el registro real en la sucursal de destino
        await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, descripcion, 
            tipo, tipo_movimiento, saldo, estado, banco_id, medio_pago_id, 
            numero_cheque, banco, cuenta, cbu, tipo_operacion
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            destino_sucursal_id,
            mov.user_id,
            mov.concepto,
            getSignedMonto(tipoDestinoReal, mov.monto),
            nuevaDescripcion,
            tipoDestinoReal,
            destino_tipo_movimiento,
            destino_saldo,
            nuevoEstado,
            destino_tipo_movimiento === "banco" ? (banco_id || mov.banco_id || null) : null,
            destino_tipo_movimiento === "banco" ? (medio_pago_id || mov.medio_pago_id || null) : null,
            destino_tipo_movimiento === "banco" ? (numero_cheque || mov.numero_cheque || null) : null,
            destino_tipo_movimiento === "banco" ? (banco || mov.banco || null) : null,
            destino_tipo_movimiento === "banco" ? (cuenta || mov.cuenta || null) : null,
            destino_tipo_movimiento === "banco" ? (cbu || mov.cbu || null) : null,
            destino_tipo_movimiento === "banco" ? (tipo_operacion || mov.tipo_operacion || null) : null,
          ]
        );

        // Creamos la deuda a favor en el Origen
        await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, descripcion, 
            tipo, tipo_movimiento, saldo, estado, es_deuda
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', 1)`,
          [
            mov.sucursal_id, // Origen
            mov.user_id,
            mov.concepto + " [DEUDA]",
            getSignedMonto(tipoOrigenDeuda, mov.monto),
            `Crédito auto-generado por movimiento hacia Sucursal ${destino_sucursal_id}`,
            tipoOrigenDeuda,
            mov.tipo_movimiento 
          ]
        );

        // Creamos la deuda en contra en el Destino
        await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, descripcion, 
            tipo, tipo_movimiento, saldo, estado, es_deuda
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', 1)`,
          [
            destino_sucursal_id, // Destino
            mov.user_id,
            mov.concepto + " [DEUDA]",
            getSignedMonto(tipoDestinoDeuda, mov.monto),
            `Deuda auto-generada recibida de Sucursal ${mov.sucursal_id}`,
            tipoDestinoDeuda,
            destino_tipo_movimiento 
          ]
        );

      } else {
        // --- CASO 2: MUEVO UN EGRESO ---
        // Según usuario: 
        // 1. Origen: Desaparece el consumo real (Movemos el original al destino).
        // 2. Destino: Carga el consumo enviado (El original modificado). 
        //             (Aclaración: El "movimiento que desaparece de Origen y se carga a Destino" es directamente hacer el flujo habitual, 
        //             donde al UPDATE se le cambia la `sucursal_id` de Origen -> Destino).
        // 3. Origen (Deuda): Generar un registro como DEUDA (en negativo) -> tipo = "egreso", es_deuda = 1.
        // 4. Destino (Deuda Extra): Generar registro extra, DEUDA a favor (positivo) -> tipo = "ingreso", es_deuda = 1.
        
        // Mover el consumo / registro hacia la sucursal de Destino (el "Mover" habitual).
        // Nótese que asume el destino_tipo_movimiento, por lo que copiamos lógica normal.
        const tipoDestinoReal = "egreso"; 
        
        if (destino_tipo_movimiento === "efectivo") {
          await query(
            `UPDATE movimientos 
             SET sucursal_id = ?, tipo_movimiento = 'efectivo', saldo = ?, estado = ?, descripcion = ?, tipo = ?, monto = ?,
                 banco_id = NULL, medio_pago_id = NULL, numero_cheque = NULL, banco = NULL, cuenta = NULL, cbu = NULL, tipo_operacion = NULL
             WHERE id = ?`,
            [destino_sucursal_id, destino_saldo, nuevoEstado, nuevaDescripcion, tipoDestinoReal, getSignedMonto(tipoDestinoReal, mov.monto), id],
          );
        } else {
          await query(
            `UPDATE movimientos 
             SET sucursal_id = ?, tipo_movimiento = 'banco', saldo = ?, estado = ?, descripcion = ?, tipo = ?, monto = ?,
                 banco_id = ?, medio_pago_id = ?, numero_cheque = ?, banco = ?, cuenta = ?, cbu = ?, tipo_operacion = ?
             WHERE id = ?`,
            [
              destino_sucursal_id,
              destino_saldo,
              nuevoEstado,
              nuevaDescripcion,
              tipoDestinoReal,
              getSignedMonto(tipoDestinoReal, mov.monto),
              banco_id || mov.banco_id || null,
              medio_pago_id || mov.medio_pago_id || null,
              numero_cheque || mov.numero_cheque || null,
              banco || mov.banco || null,
              cuenta || mov.cuenta || null,
              cbu || mov.cbu || null,
              tipo_operacion || mov.tipo_operacion || null,
              id,
            ],
          );
        }

        // Creamos la DEUDA EN CONTRA (egreso) en el ORIGEN (porque nos cobraron desde el destino el favor).
        const tipoOrigenDeuda = "egreso";
        await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, descripcion, 
            tipo, tipo_movimiento, saldo, estado, es_deuda
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', 1)`,
          [
            mov.sucursal_id, // Origen original (ahora ausente del primer registro modificado)
            mov.user_id,
            mov.concepto + " [DEUDA]",
            getSignedMonto(tipoOrigenDeuda, mov.monto),
            `Deuda auto-generada por mover consumo (egreso) a Sucursal ${destino_sucursal_id}`,
            tipoOrigenDeuda,
            mov.tipo_movimiento 
          ]
        );

        // Creamos la DEUDA A FAVOR (ingreso) en el DESTINO (porque nos pagaron u asumimos el costo a cobrar).
        const tipoDestinoDeuda = "ingreso";
        await query(
          `INSERT INTO movimientos (
            sucursal_id, user_id, fecha, concepto, monto, descripcion, 
            tipo, tipo_movimiento, saldo, estado, es_deuda
          ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 'saldo_necesario', 'aprobado', 1)`,
          [
            destino_sucursal_id, // Destino
            mov.user_id,
            mov.concepto + " [DEUDA]",
            getSignedMonto(tipoDestinoDeuda, mov.monto),
            `Crédito a cobrar generado al asumir consumo (egreso) desde Sucursal ${mov.sucursal_id}`,
            tipoDestinoDeuda,
            destino_tipo_movimiento 
          ]
        );
      }

    } else {
      // FLUJO NORMAL: Solo lo movemos de sucursal
      if (destino_tipo_movimiento === "efectivo") {
        // Mover a efectivo: limpiar datos bancarios
        await query(
          `UPDATE movimientos 
           SET sucursal_id = ?, tipo_movimiento = 'efectivo', saldo = ?, estado = ?, descripcion = ?, tipo = ?,
               banco_id = NULL, medio_pago_id = NULL, numero_cheque = NULL, banco = NULL, cuenta = NULL, cbu = NULL, tipo_operacion = NULL
           WHERE id = ?`,
          [destino_sucursal_id, destino_saldo, nuevoEstado, nuevaDescripcion, nuevoTipo, id],
        );
      } else {
        // Mover a banco: asignar nuevos datos bancarios si vienen
        await query(
          `UPDATE movimientos 
           SET sucursal_id = ?, tipo_movimiento = 'banco', saldo = ?, estado = ?, descripcion = ?, tipo = ?, 
               banco_id = ?, medio_pago_id = ?, numero_cheque = ?, banco = ?, cuenta = ?, cbu = ?, tipo_operacion = ?
           WHERE id = ?`,
          [
            destino_sucursal_id,
            destino_saldo,
            nuevoEstado,
            nuevaDescripcion,
            nuevoTipo,
            banco_id || mov.banco_id || null,
            medio_pago_id || mov.medio_pago_id || null,
            numero_cheque || mov.numero_cheque || null,
            banco || mov.banco || null,
            cuenta || mov.cuenta || null,
            cbu || mov.cbu || null,
            tipo_operacion || mov.tipo_operacion || null,
            id,
          ],
        );
      }
    }



    // Obtener movimiento actualizado
    const updatedResult: any = await query(
      "SELECT * FROM movimientos WHERE id = ?",
      [id],
    );

    res.json({
      success: true,
      message: "Movimiento movido exitosamente",
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

