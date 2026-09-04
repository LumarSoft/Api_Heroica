import { Request, Response } from 'express'
import { getCodigosPostales, isProvinciaPostalCodigo, PROVINCIAS_POSTALES } from '../services/codigosPostalesService'

export const getProvinciasPostales = async (_req: Request, res: Response) => {
  res.json({ success: true, data: PROVINCIAS_POSTALES })
}

export const getCatalogoCodigosPostales = async (req: Request, res: Response) => {
  const provincia = typeof req.query.provincia === 'string' ? req.query.provincia.trim().toUpperCase() : ''
  if (!isProvinciaPostalCodigo(provincia)) {
    return res.status(400).json({ success: false, message: 'Seleccione una provincia válida' })
  }

  try {
    const catalogo = await getCodigosPostales(provincia)
    res.json({
      success: true,
      data: catalogo.items,
      meta: { total: catalogo.items.length, fuente: 'Correo Argentino', desactualizado: catalogo.stale },
    })
  } catch {
    res.status(503).json({
      success: false,
      message: 'No pudimos consultar el catálogo postal. Podés ingresar los datos manualmente.',
    })
  }
}
