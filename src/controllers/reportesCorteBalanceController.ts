import { Request, Response } from 'express'
import { query } from '../config/database'
import { verificarAccesoSucursal } from '../utils/movimientosHelpers'
import {
  cargarCatalogoEgresos,
  guardarPlantilla,
  obtenerPlantilla,
  restablecerPlantilla,
  validarPlantilla,
} from '../services/corteBalancePlantillaService'

// GET /api/reportes/:sucursalId/corte-balance?mes=YYYY-MM&moneda=ARS
// Egresos del mes uno por uno (para clasificarlos según la plantilla) + catálogo
// de categorías/subcategorías/descripciones de egreso + plantilla vigente.
// Mismo criterio que el reporte mensual: completados/aprobados, y las deudas
// pagadas cuentan en el mes en que se pagaron (updated_at).
export const getCorteBalance = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params
    const mes = String(req.query.mes ?? '')
    const moneda = req.query.moneda === 'USD' ? 'USD' : 'ARS'

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
      return res.status(400).json({ success: false, message: 'Parámetro mes inválido (YYYY-MM)' })
    }
    if (!(await verificarAccesoSucursal(req.user!, sucursalId))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal' })
    }

    const [anio, numMes] = mes.split('-').map(Number)
    const inicio = `${mes}-01`
    const finExclusivo = numMes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(numMes + 1).padStart(2, '0')}-01`

    const [movimientos, catalogo] = await Promise.all([
      query(
        `SELECT m.id,
                DATE_FORMAT(CASE WHEN m.es_deuda = 1 THEN m.updated_at ELSE m.fecha END, '%Y-%m-%d') AS fecha,
                ABS(m.monto) AS monto, m.tipo_movimiento AS medio,
                m.categoria_id, c.nombre AS categoria_nombre,
                m.subcategoria_id, s.nombre AS subcategoria_nombre,
                m.descripcion_id, d.nombre AS descripcion_nombre,
                p.nombre AS proveedor_nombre, m.comentarios, m.es_deuda
         FROM movimientos m
         LEFT JOIN categorias c ON m.categoria_id = c.id
         LEFT JOIN subcategorias s ON m.subcategoria_id = s.id
         LEFT JOIN descripciones d ON m.descripcion_id = d.id
         LEFT JOIN proveedores p ON m.proveedor_id = p.id
         WHERE m.sucursal_id = ?
           AND m.moneda = ?
           AND m.tipo = 'egreso'
           AND m.deleted_at IS NULL
           AND m.estado IN ('completado', 'aprobado')
           AND NOT (m.tipo_movimiento = 'banco' AND m.categoria_id IS NULL)
           AND (
             ((m.es_deuda = 0 OR m.es_deuda IS NULL) AND m.fecha >= ? AND m.fecha < ?)
             OR (m.es_deuda = 1 AND m.estado = 'completado' AND m.updated_at >= ? AND m.updated_at < ?)
           )
         ORDER BY fecha ASC, m.id ASC`,
        [sucursalId, moneda, inicio, finExclusivo, inicio, finExclusivo],
      ) as Promise<Record<string, unknown>[]>,
      cargarCatalogoEgresos(),
    ])

    const { plantilla, esPorDefecto, actualizadaEn } = await obtenerPlantilla(catalogo)

    res.json({
      success: true,
      data: {
        mes,
        moneda,
        movimientos: movimientos.map(m => ({
          id: Number(m.id),
          fecha: String(m.fecha),
          monto: Number(m.monto),
          medio: m.medio === 'banco' ? 'banco' : 'efectivo',
          categoria_id: m.categoria_id === null ? null : Number(m.categoria_id),
          categoria_nombre: (m.categoria_nombre as string | null) ?? null,
          subcategoria_id: m.subcategoria_id === null ? null : Number(m.subcategoria_id),
          subcategoria_nombre: (m.subcategoria_nombre as string | null) ?? null,
          descripcion_id: m.descripcion_id === null ? null : Number(m.descripcion_id),
          descripcion_nombre: (m.descripcion_nombre as string | null) ?? null,
          proveedor_nombre: (m.proveedor_nombre as string | null) ?? null,
          comentarios: (m.comentarios as string | null) ?? null,
          es_deuda: Number(m.es_deuda) === 1,
        })),
        catalogo,
        plantilla,
        plantillaEsPorDefecto: esPorDefecto,
        plantillaActualizadaEn: actualizadaEn,
      },
    })
  } catch (error) {
    console.error('Error al obtener corte de balance:', error)
    res.status(500).json({ success: false, message: 'Error al obtener el corte de balance' })
  }
}

// PUT /api/reportes/corte-balance/plantilla
export const putPlantillaCorteBalance = async (req: Request, res: Response) => {
  let plantilla
  try {
    plantilla = validarPlantilla(req.body?.plantilla)
  } catch (err: unknown) {
    return res.status(400).json({ success: false, message: err instanceof Error ? err.message : 'Plantilla inválida' })
  }
  try {
    await guardarPlantilla(plantilla, req.user!.id)
    res.json({ success: true, data: { plantilla } })
  } catch (error) {
    console.error('Error al guardar plantilla de corte de balance:', error)
    const message = error instanceof Error && error.message.startsWith('Falta aplicar') ? error.message : null
    res.status(500).json({ success: false, message: message ?? 'Error al guardar la plantilla' })
  }
}

// DELETE /api/reportes/corte-balance/plantilla — vuelve a la plantilla por defecto
export const deletePlantillaCorteBalance = async (_req: Request, res: Response) => {
  try {
    await restablecerPlantilla()
    const { plantilla } = await obtenerPlantilla(await cargarCatalogoEgresos())
    res.json({ success: true, data: { plantilla } })
  } catch (error) {
    console.error('Error al restablecer plantilla de corte de balance:', error)
    res.status(500).json({ success: false, message: 'Error al restablecer la plantilla' })
  }
}
