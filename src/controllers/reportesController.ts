import { Request, Response } from 'express';
import { query } from '../config/database';

// GET /api/reportes/:sucursalId
// Query params opcionales: startDate, endDate
export const getReportesBySucursal = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;
    const { startDate, endDate, moneda = 'ARS' } = req.query;
    const user = req.user!;

    // Verificar acceso a la sucursal
    const rolResult: any = await query(
      `SELECT nombre FROM roles WHERE id = ?`,
      [user.rol_id],
    );
    const isSuperAdmin =
      rolResult.length > 0 && rolResult[0].nombre === 'superadmin';
    if (!isSuperAdmin) {
      const acceso: any = await query(
        `SELECT 1 FROM usuarios_sucursales WHERE usuario_id = ? AND sucursal_id = ?`,
        [user.id, sucursalId],
      );
      if (!acceso || acceso.length === 0) {
        return res
          .status(403)
          .json({ success: false, message: 'No tenés acceso a esta sucursal' });
      }
    }

    let sql = `
      SELECT m.id, m.fecha, m.concepto, m.monto, m.tipo, m.tipo_movimiento as medio_pago,
             m.estado, m.categoria_id, m.subcategoria_id, c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
             d.nombre as descripcion_nombre, p.nombre as proveedor_nombre,
             m.es_deuda, m.updated_at
      FROM movimientos m
      LEFT JOIN categorias c ON m.categoria_id = c.id
      LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
      LEFT JOIN descripciones d ON m.descripcion_id = d.id
      LEFT JOIN proveedores p ON m.proveedor_id = p.id
      WHERE m.sucursal_id = ?
        AND m.moneda = ?
        AND m.deleted_at IS NULL
        AND m.estado IN ('completado', 'aprobado')
        AND (
          (m.es_deuda = 0 OR m.es_deuda IS NULL)
          OR 
          (m.es_deuda = 1 AND m.estado = 'completado')
        )
    `;

    const params: any[] = [sucursalId, moneda];

    if (startDate && endDate) {
      sql += ` AND (
        ((m.es_deuda = 0 OR m.es_deuda IS NULL) AND m.fecha >= ? AND m.fecha <= ?)
        OR 
        (m.es_deuda = 1 AND m.estado = 'completado' AND DATE(m.updated_at) >= ? AND DATE(m.updated_at) <= ?)
      )`;
      params.push(startDate, endDate, startDate, endDate);
    } else if (startDate) {
      sql += ` AND (
        ((m.es_deuda = 0 OR m.es_deuda IS NULL) AND m.fecha >= ?)
        OR 
        (m.es_deuda = 1 AND m.estado = 'completado' AND DATE(m.updated_at) >= ?)
      )`;
      params.push(startDate, startDate);
    } else if (endDate) {
      sql += ` AND (
        ((m.es_deuda = 0 OR m.es_deuda IS NULL) AND m.fecha <= ?)
        OR 
        (m.es_deuda = 1 AND m.estado = 'completado' AND DATE(m.updated_at) <= ?)
      )`;
      params.push(endDate, endDate);
    }

    sql += ' ORDER BY m.fecha DESC';

    const movimientos: any = await query(sql, params);

    let ingresosTotales = 0;
    let egresosTotales = 0;

    const ingresosPorCategoria: Record<
      string,
      { total: number; subcategorias: Record<string, number> }
    > = {};
    const egresosPorCategoria: Record<
      string,
      { total: number; subcategorias: Record<string, number> }
    > = {};

    const ingresosList: any[] = [];
    const egresosList: any[] = [];

    movimientos.forEach((mov: any) => {
      // Si el movimiento es el pago de una deuda, usamos la fecha de pago (updated_at)
      if (mov.es_deuda === 1 && mov.estado === 'completado' && mov.updated_at) {
        mov.fecha = mov.updated_at;
      }

      const monto = Number(mov.monto);
      const catNombre = mov.categoria_nombre || 'Sin Categoría';
      const subCatNombre = mov.subcategoria_nombre || 'Sin Subcategoría';

      if (mov.tipo === 'ingreso') {
        ingresosTotales += monto;

        if (!ingresosPorCategoria[catNombre]) {
          ingresosPorCategoria[catNombre] = { total: 0, subcategorias: {} };
        }
        ingresosPorCategoria[catNombre].total += monto;
        ingresosPorCategoria[catNombre].subcategorias[subCatNombre] =
          (ingresosPorCategoria[catNombre].subcategorias[subCatNombre] || 0) +
          monto;

        ingresosList.push(mov);
      } else if (mov.tipo === 'egreso') {
        const montoAbs = Math.abs(monto);
        egresosTotales += montoAbs;

        if (!egresosPorCategoria[catNombre]) {
          egresosPorCategoria[catNombre] = { total: 0, subcategorias: {} };
        }
        egresosPorCategoria[catNombre].total += montoAbs;
        egresosPorCategoria[catNombre].subcategorias[subCatNombre] =
          (egresosPorCategoria[catNombre].subcategorias[subCatNombre] || 0) +
          montoAbs;

        egresosList.push(mov);
      }
    });

    const formatBreakdown = (
      breakdownRecord: Record<
        string,
        { total: number; subcategorias: Record<string, number> }
      >,
    ) => {
      return Object.entries(breakdownRecord)
        .map(([name, data]) => ({
          name,
          value: data.total,
          subcategorias: Object.entries(data.subcategorias)
            .map(([subName, subValue]) => ({ name: subName, value: subValue }))
            .sort((a, b) => b.value - a.value),
        }))
        .sort((a, b) => b.value - a.value); // Sort descending
    };

    // DEUDAS (Respetar fecha límite del mes, si se envía)
    let sqlDeudas = `
      SELECT m.id, m.fecha, m.concepto, m.monto, m.tipo, m.tipo_movimiento as medio_pago,
             m.estado, m.categoria_id, m.subcategoria_id, c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
             d.nombre as descripcion_nombre, p.nombre as proveedor_nombre,
             m.es_deuda, m.updated_at
      FROM movimientos m
      LEFT JOIN categorias c ON m.categoria_id = c.id
      LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
      LEFT JOIN descripciones d ON m.descripcion_id = d.id
      LEFT JOIN proveedores p ON m.proveedor_id = p.id
      WHERE m.sucursal_id = ? 
        AND m.moneda = ?
        AND m.es_deuda = 1
        AND m.tipo = 'egreso'
    `;
    const deudasParams: any[] = [sucursalId, moneda];

    if (endDate) {
      sqlDeudas += ' AND m.fecha <= ?';
      deudasParams.push(endDate);

      // Si el mes consultado es anterior al pago de la deuda, la deuda debe seguir mostrándose como activa en ese mes
      sqlDeudas += " AND (m.estado != 'completado' OR DATE(m.updated_at) > ?)";
      deudasParams.push(endDate);
    } else {
      sqlDeudas += " AND m.estado != 'completado'";
    }

    sqlDeudas += ' ORDER BY m.fecha DESC';

    const deudasList: any = await query(sqlDeudas, deudasParams);
    const deudasTotales = deudasList.reduce(
      (acc: number, mov: any) => acc + Math.abs(Number(mov.monto)),
      0,
    );

    // CREDITOS (Respetar fecha límite del mes, si se envía)
    let sqlCreditos = `
      SELECT m.id, m.fecha, m.concepto, m.monto, m.tipo, m.tipo_movimiento as medio_pago,
             m.estado, m.categoria_id, m.subcategoria_id, c.nombre as categoria_nombre, s.nombre as subcategoria_nombre,
             d.nombre as descripcion_nombre, p.nombre as proveedor_nombre,
             m.es_deuda, m.updated_at
      FROM movimientos m
      LEFT JOIN categorias c ON m.categoria_id = c.id
      LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
      LEFT JOIN descripciones d ON m.descripcion_id = d.id
      LEFT JOIN proveedores p ON m.proveedor_id = p.id
      WHERE m.sucursal_id = ? 
        AND m.moneda = ?
        AND m.es_deuda = 1
        AND m.tipo = 'ingreso'
    `;
    const creditosParams: any[] = [sucursalId, moneda];

    if (endDate) {
      sqlCreditos += ' AND m.fecha <= ?';
      creditosParams.push(endDate);

      // Si el mes consultado es anterior al cobro del crédito, el crédito debe seguir mostrándose como activo en ese mes
      sqlCreditos += " AND (m.estado != 'completado' OR DATE(m.updated_at) > ?)";
      creditosParams.push(endDate);
    } else {
      sqlCreditos += " AND m.estado != 'completado'";
    }

    sqlCreditos += ' ORDER BY m.fecha DESC';

    const creditosList: any = await query(sqlCreditos, creditosParams);
    const creditosTotales = creditosList.reduce(
      (acc: number, mov: any) => acc + Math.abs(Number(mov.monto)),
      0,
    );

    res.json({
      success: true,
      data: {
        resumen: {
          ingresos: ingresosTotales,
          egresos: egresosTotales,
          resultado: ingresosTotales - egresosTotales,
          deudas: deudasTotales,
          creditos: creditosTotales,
        },
        ingresosBreakdown: formatBreakdown(ingresosPorCategoria),
        egresosBreakdown: formatBreakdown(egresosPorCategoria),
        detalles: {
          ingresos: ingresosList,
          egresos: egresosList,
          deudas: deudasList,
          creditos: creditosList,
        },
      },
    });
  } catch (error) {
    console.error('Error al obtener reportes:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener reportes',
    });
  }
};

// GET /api/reportes/:sucursalId/anual
// Retorna ingresos, egresos y resultado agrupados por mes (todos los meses disponibles)
export const getReportesAnual = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params;
    const { moneda = 'ARS' } = req.query;
    const user = req.user!;

    // Verificar acceso a la sucursal
    const rolResult: any = await query(
      `SELECT nombre FROM roles WHERE id = ?`,
      [user.rol_id],
    );
    const isSuperAdmin =
      rolResult.length > 0 && rolResult[0].nombre === 'superadmin';
    if (!isSuperAdmin) {
      const acceso: any = await query(
        `SELECT 1 FROM usuarios_sucursales WHERE usuario_id = ? AND sucursal_id = ?`,
        [user.id, sucursalId],
      );
      if (!acceso || acceso.length === 0) {
        return res
          .status(403)
          .json({ success: false, message: 'No tenés acceso a esta sucursal' });
      }
    }

    const [rows, catRows]: [any, any] = await Promise.all([
      query(
        `SELECT
           DATE_FORMAT(m.fecha, '%Y-%m') AS mes,
           SUM(CASE WHEN m.tipo = 'ingreso' THEN ABS(m.monto) ELSE 0 END) AS ingresos,
           SUM(CASE WHEN m.tipo = 'egreso'  THEN ABS(m.monto) ELSE 0 END) AS egresos
         FROM movimientos m
         WHERE m.sucursal_id = ?
           AND m.moneda = ?
           AND m.deleted_at IS NULL
           AND m.estado IN ('completado', 'aprobado')
           AND (m.es_deuda = 0 OR m.es_deuda IS NULL OR (m.es_deuda = 1 AND m.estado = 'completado'))
         GROUP BY mes
         ORDER BY mes ASC`,
        [sucursalId, moneda],
      ),
      query(
        `SELECT
           DATE_FORMAT(m.fecha, '%Y-%m') AS mes,
           COALESCE(c.nombre, 'Sin Categoría') AS categoria,
           m.tipo,
           SUM(ABS(m.monto)) AS total
         FROM movimientos m
         LEFT JOIN categorias c ON m.categoria_id = c.id
         WHERE m.sucursal_id = ?
           AND m.moneda = ?
           AND m.deleted_at IS NULL
           AND m.estado IN ('completado', 'aprobado')
           AND (m.es_deuda = 0 OR m.es_deuda IS NULL OR (m.es_deuda = 1 AND m.estado = 'completado'))
         GROUP BY mes, categoria, m.tipo
         ORDER BY mes ASC`,
        [sucursalId, moneda],
      ),
    ]);

    const mensual = rows.map((row: any) => ({
      mes: row.mes as string,
      ingresos: Number(row.ingresos),
      egresos: Number(row.egresos),
      resultado: Number(row.ingresos) - Number(row.egresos),
    }));

    const porCategoria = catRows.map((row: any) => ({
      mes: row.mes as string,
      categoria: row.categoria as string,
      tipo: row.tipo as 'ingreso' | 'egreso',
      total: Number(row.total),
    }));

    res.json({ success: true, data: { mensual, porCategoria } });
  } catch (error) {
    console.error('Error al obtener reportes anuales:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener reportes anuales',
    });
  }
};
