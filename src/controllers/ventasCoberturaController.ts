import { Request, Response } from 'express'
import { query } from '../config/database'
import type { FuenteVentas } from '../services/ventas/types'

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TRAMOS = 12

interface Tramo {
  desde: string
  hasta: string
  dias: number
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Días de [desde, hasta] que NO están en `importados`, agrupados en tramos consecutivos. */
function tramosFaltantes(importados: Set<string>, desde: string, hasta: string): Tramo[] {
  const tramos: Tramo[] = []
  let actual: Tramo | null = null
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 1)) {
    if (importados.has(dia)) {
      actual = null
      continue
    }
    if (actual) {
      actual.hasta = dia
      actual.dias++
    } else {
      actual = { desde: dia, hasta: dia, dias: 1 }
      tramos.push(actual)
    }
  }
  return tramos
}

/**
 * GET /api/ventas/cobertura?desde=&hasta=
 * Qué días de ventas hay importados: rango disponible, última actualización y días
 * faltantes (en todo el rango disponible y, si se pasa, dentro del período consultado).
 */
export const getCoberturaVentas = async (req: Request, res: Response) => {
  const desde = typeof req.query.desde === 'string' && FECHA_RE.test(req.query.desde) ? req.query.desde : null
  const hasta = typeof req.query.hasta === 'string' && FECHA_RE.test(req.query.hasta) ? req.query.hasta : null
  const fuente: FuenteVentas = 'bistrosoft'

  try {
    const [filas, [ultima]] = (await Promise.all([
      query(
        `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, lineas FROM ventas_dias_sincronizados
         WHERE fuente = ? ORDER BY fecha`,
        [fuente],
      ),
      query(
        `SELECT DATE_FORMAT(MAX(actualizado_at), '%Y-%m-%dT%H:%i:%s') AS ultima FROM ventas_dias_sincronizados
         WHERE fuente = ?`,
        [fuente],
      ),
    ])) as [Array<{ fecha: string; lineas: number }>, Array<{ ultima: string | null }>]

    const importados = new Set(filas.map(f => f.fecha))
    const primero = filas[0]?.fecha ?? null
    const ultimo = filas[filas.length - 1]?.fecha ?? null
    const huecos = primero && ultimo ? tramosFaltantes(importados, primero, ultimo) : []
    const enRango = desde && hasta && desde <= hasta ? tramosFaltantes(importados, desde, hasta) : []

    res.json({
      success: true,
      data: {
        fuente,
        desde: primero,
        hasta: ultimo,
        diasImportados: filas.length,
        diasSinVentas: filas.filter(f => Number(f.lineas) === 0).length,
        ultimaActualizacion: ultima?.ultima ?? null,
        faltantes: huecos.slice(0, MAX_TRAMOS),
        diasFaltantes: huecos.reduce((acc, t) => acc + t.dias, 0),
        faltantesEnPeriodo: enRango.slice(0, MAX_TRAMOS),
        diasFaltantesEnPeriodo: enRango.reduce((acc, t) => acc + t.dias, 0),
      },
    })
  } catch (err: unknown) {
    console.error('[Ventas] Error en getCoberturaVentas:', err instanceof Error ? err.message : err)
    res.status(500).json({ success: false, message: 'Error al consultar los días importados' })
  }
}
