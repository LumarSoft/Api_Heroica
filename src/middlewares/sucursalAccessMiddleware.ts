import type { NextFunction, Request, Response } from 'express'
import { query } from '../config/database'
import { assertSucursalAccess, SucursalAccessError, responderSinAcceso } from '../utils/sucursalAccess'

type Fuente = 'params' | 'query' | 'body'

/**
 * Recursos cuyo sucursal_id se resuelve con un lookup por id.
 * Las consultas están acá como literales: nunca se arma SQL con datos de la request.
 */
const LOOKUPS = {
  movimiento: 'SELECT sucursal_id FROM movimientos WHERE id = ?',
  personal: 'SELECT sucursal_id FROM personal WHERE id = ?',
  escala: 'SELECT sucursal_id FROM escalas_salariales WHERE id = ?',
  incentivo: 'SELECT sucursal_id FROM rrhh_incentivos_premios WHERE id = ?',
  cuentaBancaria: 'SELECT sucursal_id FROM cuentas_bancarias_sucursal WHERE id = ?',
} as const

export type RecursoConSucursal = keyof typeof LOOKUPS

interface FilaConSucursal {
  sucursal_id: number | null
}

/**
 * Resuelve la sucursal del recurso identificado por `param` y verifica el acceso.
 *
 * Si el recurso no existe deja pasar: el controlador responde el 404 que corresponda, y así no se
 * filtra por diferencia de status qué ids existen.
 */
export function requireSucursalAccessDeRecurso(recurso: RecursoConSucursal, param = 'id') {
  const sql = LOOKUPS[recurso]

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params?.[param]
      if (id === undefined || id === '' || Number.isNaN(Number(id))) {
        next()
        return
      }

      const filas = (await query(sql, [Number(id)])) as FilaConSucursal[]
      if (!filas.length) {
        next()
        return
      }

      await assertSucursalAccess(req, filas[0].sucursal_id)
      next()
    } catch (err: unknown) {
      if (err instanceof SucursalAccessError) {
        responderSinAcceso(res)
        return
      }
      next(err)
    }
  }
}

function leerValor(req: Request, source: Fuente, key: string): unknown {
  if (source === 'params') return req.params?.[key]
  if (source === 'query') return req.query?.[key]
  return (req.body as Record<string, unknown> | undefined)?.[key]
}

/**
 * Verifica el acceso a la sucursal cuyo id viene directo en la request.
 *
 * Para rutas donde el id de sucursal no viaja explícito (p. ej. /:id de un movimiento) hay que
 * hacer el lookup en el controlador: cargar la fila, leer su sucursal_id y llamar a
 * assertSucursalAccess antes de leer o escribir.
 *
 * Si el valor no está presente el middleware deja pasar: la ruta decide si el filtro es opcional
 * (en cuyo caso el controlador debe acotar por las sucursales del usuario).
 */
export function requireSucursalAccess(source: Fuente, key: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const valor = leerValor(req, source, key)
      if (valor === undefined || valor === null || valor === '') {
        next()
        return
      }
      await assertSucursalAccess(req, valor as string | number)
      next()
    } catch (err: unknown) {
      if (err instanceof SucursalAccessError) {
        responderSinAcceso(res)
        return
      }
      next(err)
    }
  }
}

/**
 * Variante para rutas donde el id puede venir en la query o en el body (los PUT de sueldos).
 * Toma el primero que esté presente.
 */
export function requireSucursalAccessQueryOrBody(key: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const desdeQuery = req.query?.[key]
      const desdeBody = (req.body as Record<string, unknown> | undefined)?.[key]
      const valor = desdeQuery !== undefined && desdeQuery !== '' ? desdeQuery : desdeBody

      if (valor === undefined || valor === null || valor === '') {
        next()
        return
      }
      await assertSucursalAccess(req, valor as string | number)
      next()
    } catch (err: unknown) {
      if (err instanceof SucursalAccessError) {
        responderSinAcceso(res)
        return
      }
      next(err)
    }
  }
}
