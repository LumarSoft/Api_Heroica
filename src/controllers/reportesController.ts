import { Request, Response } from "express";
import { query } from "../config/database";

// GET /api/reportes/:sucursalId
// Query params opcionales: startDate, endDate
export const getReportesBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;
    const { startDate, endDate } = req.query;

    let sql = `
      SELECT m.id, m.fecha, m.concepto, m.monto, m.tipo, m.tipo_movimiento as medio_pago,
             m.estado, m.categoria_id, c.nombre as categoria_nombre
      FROM movimientos m
      LEFT JOIN categorias c ON m.categoria_id = c.id
      WHERE m.sucursal_id = ? 
        AND m.estado IN ('completado', 'aprobado')
    `;

    const params: any[] = [sucursalId];

    if (startDate) {
      sql += " AND m.fecha >= ?";
      params.push(startDate);
    }
    
    if (endDate) {
      sql += " AND m.fecha <= ?";
      params.push(endDate);
    }

    sql += " ORDER BY m.fecha DESC";

    const movimientos: any = await query(sql, params);

    let ingresosTotales = 0;
    let egresosTotales = 0;

    const ingresosPorCategoria: Record<string, number> = {};
    const egresosPorCategoria: Record<string, number> = {};

    const ingresosList: any[] = [];
    const egresosList: any[] = [];

    movimientos.forEach((mov: any) => {
      const monto = Number(mov.monto);
      const catNombre = mov.categoria_nombre || "Sin Categoría";

      if (mov.tipo === "ingreso") {
        ingresosTotales += monto;
        ingresosPorCategoria[catNombre] = (ingresosPorCategoria[catNombre] || 0) + monto;
        ingresosList.push(mov);
      } else if (mov.tipo === "egreso") {
        const montoAbs = Math.abs(monto);
        egresosTotales += montoAbs;
        egresosPorCategoria[catNombre] = (egresosPorCategoria[catNombre] || 0) + montoAbs;
        egresosList.push(mov);
      }
    });

    const formatBreakdown = (breakdownRecord: Record<string, number>) => {
      return Object.entries(breakdownRecord)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value); // Sort descending
    };

    res.json({
      success: true,
      data: {
        resumen: {
          ingresos: ingresosTotales,
          egresos: egresosTotales,
          resultado: ingresosTotales - egresosTotales,
        },
        ingresosBreakdown: formatBreakdown(ingresosPorCategoria),
        egresosBreakdown: formatBreakdown(egresosPorCategoria),
        detalles: {
          ingresos: ingresosList,
          egresos: egresosList,
        }
      },
    });
  } catch (error) {
    console.error("Error al obtener reportes:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener reportes",
    });
  }
};
