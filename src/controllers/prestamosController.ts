import { Request, Response } from 'express'
import {
  PrestamoError,
  aceptarPrestamo,
  anularDevolucion,
  anularPrestamo,
  cancelarPrestamo,
  confirmarDevolucion,
  crearDevolucion,
  crearPrestamo,
  estadoDeCuenta,
  pendientesDeDevolver,
  porConfirmar,
  rechazarDevolucion,
  rechazarPrestamo,
  sucursalesActivas,
} from '../services/prestamosService'

/** Envuelve cada handler: los PrestamoError se devuelven con su status, el resto es 500. */
const manejar =
  (nombre: string, fn: (req: Request) => Promise<unknown>, mensajeOk?: (data: any) => string) =>
  async (req: Request, res: Response) => {
    try {
      const data = await fn(req)
      res.json({ success: true, data, ...(mensajeOk ? { message: mensajeOk(data) } : {}) })
    } catch (error) {
      if (error instanceof PrestamoError) {
        return res.status(error.status).json({ success: false, message: error.message })
      }
      console.error(`Error en ${nombre}:`, error)
      res.status(500).json({ success: false, message: 'Error al procesar el préstamo' })
    }
  }

const id = (req: Request, campo = 'id') => Number(req.params[campo])

// GET /api/prestamos/sucursales
export const getSucursales = manejar('getSucursales', () => sucursalesActivas())

// GET /api/prestamos/:sucursalId/estado-cuenta?moneda=
export const getEstadoCuenta = manejar('getEstadoCuenta', req =>
  estadoDeCuenta(req.user!, id(req, 'sucursalId'), req.query.moneda as string | undefined),
)

// GET /api/prestamos/:sucursalId/por-confirmar?caja=&moneda=
export const getPorConfirmar = manejar('getPorConfirmar', req =>
  porConfirmar(req.user!, id(req, 'sucursalId'), String(req.query.caja), String(req.query.moneda)),
)

// GET /api/prestamos/:sucursalId/pendientes-devolver?moneda=
export const getPendientesDevolver = manejar('getPendientesDevolver', req =>
  pendientesDeDevolver(req.user!, id(req, 'sucursalId'), String(req.query.moneda)),
)

// POST /api/prestamos
export const postPrestamo = manejar(
  'postPrestamo',
  req => crearPrestamo(req.user!, req.body),
  (d: { directo: boolean }) =>
    d.directo ? 'Préstamo registrado' : 'Pedido enviado: falta que la otra sucursal lo acepte',
)

// POST /api/prestamos/:id/aceptar   { fecha?, banco_salida_id? }
export const postAceptar = manejar(
  'postAceptar',
  req => aceptarPrestamo(req.user!, id(req), req.body),
  () => 'Préstamo aceptado',
)

// POST /api/prestamos/:id/rechazar  { motivo }
export const postRechazar = manejar(
  'postRechazar',
  req => rechazarPrestamo(req.user!, id(req), req.body),
  () => 'Pedido rechazado',
)

// POST /api/prestamos/:id/cancelar
export const postCancelar = manejar(
  'postCancelar',
  req => cancelarPrestamo(req.user!, id(req)),
  () => 'Pedido cancelado',
)

// POST /api/prestamos/:id/anular
export const postAnular = manejar(
  'postAnular',
  req => anularPrestamo(req.user!, id(req)),
  () => 'Préstamo anulado',
)

// POST /api/prestamos/:id/devoluciones
export const postDevolucion = manejar(
  'postDevolucion',
  req => crearDevolucion(req.user!, id(req), req.body),
  (d: { directo: boolean }) =>
    d.directo ? 'Devolución registrada' : 'Devolución enviada: falta que la otra sucursal la confirme',
)

// POST /api/prestamos/devoluciones/:id/confirmar   { fecha?, banco_entrada_id? }
export const postConfirmarDevolucion = manejar(
  'postConfirmarDevolucion',
  req => confirmarDevolucion(req.user!, id(req), req.body),
  () => 'Devolución confirmada',
)

// POST /api/prestamos/devoluciones/:id/rechazar  { motivo }
export const postRechazarDevolucion = manejar(
  'postRechazarDevolucion',
  req => rechazarDevolucion(req.user!, id(req), req.body),
  () => 'Devolución rechazada',
)

// POST /api/prestamos/devoluciones/:id/anular
export const postAnularDevolucion = manejar(
  'postAnularDevolucion',
  req => anularDevolucion(req.user!, id(req)),
  () => 'Devolución anulada',
)
