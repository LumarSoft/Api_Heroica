import { getConnection, query } from '../config/database'
import { esSuperadmin, getPermisosDeRol, getSucursalesDeUsuario } from './authCacheService'
import { normalizarFecha, formatearFechaRespuesta } from '../utils/movimientosHelpers'

// ─────────────────────────────────────────────────────────────
//  Préstamos entre sucursales
//
//  Un préstamo es plata que pasa de la caja de una sucursal a la de otra y una devolución es
//  plata que vuelve. Los movimientos que generan llevan origen = 'prestamo': cuentan en el
//  saldo real de cada caja pero no son gasto ni ingreso del negocio (quedan fuera de reportes)
//  y no se editan desde la caja.
//
//  Pedido (o devolución) → la sucursal que presta lo acepta desde su caja → se crean los dos
//  movimientos. Si quien carga ya puede aprobar en la otra sucursal, se registra directo.
// ─────────────────────────────────────────────────────────────

type Caja = 'efectivo' | 'banco'
type Moneda = 'ARS' | 'USD'

interface Usuario {
  id: number
  rol_id: number
}

export class PrestamoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

interface Tramo {
  caja: Caja
  bancoId: number | null
}

interface DatosMovimientos {
  sucursalSale: number
  sucursalEntra: number
  sale: Tramo
  entra: Tramo
  monto: number
  moneda: Moneda
  fecha: string
  conceptoSale: string
  conceptoEntra: string
  comentarios: string
  userId: number
}

const CAJAS: Caja[] = ['efectivo', 'banco']

const redondear = (n: number) => Math.round(n * 100) / 100

export const hoy = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Permisos ────────────────────────────────────────────────────

async function tieneAcceso(user: Usuario, sucursalId: number): Promise<boolean> {
  if (await esSuperadmin(user.rol_id)) return true
  return (await getSucursalesDeUsuario(user.id)).has(Number(sucursalId))
}

/** Puede aceptar pedidos y devoluciones de esa sucursal (o registrarlos directo). */
async function puedeAprobarEn(user: Usuario, sucursalId: number): Promise<boolean> {
  if (await esSuperadmin(user.rol_id)) return true
  if (!(await getSucursalesDeUsuario(user.id)).has(Number(sucursalId))) return false
  return (await getPermisosDeRol(user.rol_id)).has('aprobar_movimientos')
}

async function exigirAcceso(user: Usuario, sucursalId: number) {
  if (!(await tieneAcceso(user, sucursalId))) throw new PrestamoError(403, 'No tenés acceso a esta sucursal')
}

async function exigirAprobacion(user: Usuario, sucursalId: number) {
  if (!(await puedeAprobarEn(user, sucursalId))) {
    throw new PrestamoError(403, 'No tenés permiso para aceptar o rechazar operaciones de esta sucursal')
  }
}

// ── Validaciones de entrada ─────────────────────────────────────

function parseMonto(valor: unknown): number {
  const monto = redondear(Number(valor))
  if (!Number.isFinite(monto) || monto <= 0) throw new PrestamoError(400, 'El monto debe ser mayor a cero')
  return monto
}

function parseFecha(valor: unknown): string {
  if (valor === undefined || valor === null || valor === '') return hoy()
  const texto = String(valor).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new PrestamoError(400, 'La fecha no es válida')
  return texto
}

function parseCaja(valor: unknown, campo: string): Caja {
  if (!CAJAS.includes(valor as Caja)) throw new PrestamoError(400, `Falta indicar la caja de ${campo}`)
  return valor as Caja
}

function parseMoneda(valor: unknown): Moneda {
  return valor === 'USD' ? 'USD' : 'ARS'
}

async function parseTramo(caja: unknown, bancoId: unknown, campo: string, conn: any): Promise<Tramo> {
  const c = parseCaja(caja, campo)
  if (c === 'efectivo') return { caja: c, bancoId: null }
  const id = Number(bancoId)
  if (!Number.isInteger(id) || id <= 0) throw new PrestamoError(400, `Falta elegir el banco de ${campo}`)
  const [bancos]: any = await conn.execute('SELECT id FROM bancos WHERE id = ? AND deleted_at IS NULL', [id])
  if (bancos.length === 0) throw new PrestamoError(400, `El banco de ${campo} no existe`)
  return { caja: c, bancoId: id }
}

async function nombreSucursal(conn: any, id: number): Promise<string> {
  const [filas]: any = await conn.execute('SELECT nombre FROM sucursales WHERE id = ?', [id])
  return filas[0]?.nombre ?? `Sucursal ${id}`
}

async function exigirSucursalActiva(conn: any, id: number) {
  const [filas]: any = await conn.execute(
    'SELECT id FROM sucursales WHERE id = ? AND deleted_at IS NULL AND activo = 1',
    [id],
  )
  if (filas.length === 0) throw new PrestamoError(400, 'La sucursal no existe o está inactiva')
}

// ── Movimientos ─────────────────────────────────────────────────

async function saldoReal(conn: any, sucursalId: number, tramo: Tramo, moneda: Moneda): Promise<number> {
  const [filas]: any = await conn.execute(
    `SELECT COALESCE(SUM(monto), 0) AS total FROM movimientos
     WHERE sucursal_id = ? AND tipo_movimiento = ? AND moneda = ? AND estado = 'completado' AND deleted_at IS NULL
       ${tramo.caja === 'banco' ? 'AND banco_id = ?' : ''}`,
    tramo.caja === 'banco' ? [sucursalId, tramo.caja, moneda, tramo.bancoId] : [sucursalId, tramo.caja, moneda],
  )
  return Number(filas[0]?.total ?? 0)
}

async function exigirSaldo(conn: any, sucursalId: number, tramo: Tramo, moneda: Moneda, monto: number) {
  const disponible = await saldoReal(conn, sucursalId, tramo, moneda)
  if (disponible < monto) {
    const simbolo = moneda === 'USD' ? 'US$' : '$'
    const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    throw new PrestamoError(
      400,
      `Saldo insuficiente: la caja de donde sale la plata tiene ${simbolo} ${fmt(disponible)} de saldo real y no alcanza para ${simbolo} ${fmt(monto)}`,
    )
  }
}

async function insertarMovimiento(
  conn: any,
  d: { sucursalId: number; tramo: Tramo; tipo: 'ingreso' | 'egreso'; concepto: string } & DatosMovimientos,
): Promise<number> {
  const [res]: any = await conn.execute(
    `INSERT INTO movimientos
     (sucursal_id, user_id, fecha, concepto, comentarios, monto, tipo, tipo_movimiento, origen, saldo, estado,
      prioridad, banco_id, moneda)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prestamo', 'saldo_real', 'completado', 'media', ?, ?)`,
    [
      d.sucursalId,
      d.userId,
      normalizarFecha(d.fecha),
      d.concepto,
      d.comentarios,
      d.tipo === 'egreso' ? -Math.abs(d.monto) : Math.abs(d.monto),
      d.tipo,
      d.tramo.caja,
      d.tramo.caja === 'banco' ? d.tramo.bancoId : null,
      d.moneda,
    ],
  )
  return res.insertId
}

/** Crea el egreso en la sucursal que paga y el ingreso en la que cobra (en Saldo Real). */
async function crearMovimientos(conn: any, d: DatosMovimientos): Promise<{ salida: number; entrada: number }> {
  await exigirSaldo(conn, d.sucursalSale, d.sale, d.moneda, d.monto)
  const salida = await insertarMovimiento(conn, {
    ...d,
    sucursalId: d.sucursalSale,
    tramo: d.sale,
    tipo: 'egreso',
    concepto: d.conceptoSale,
  })
  const entrada = await insertarMovimiento(conn, {
    ...d,
    sucursalId: d.sucursalEntra,
    tramo: d.entra,
    tipo: 'ingreso',
    concepto: d.conceptoEntra,
  })
  return { salida, entrada }
}

async function anularMovimientos(conn: any, ids: (number | null)[]) {
  const validos = ids.filter((id): id is number => Boolean(id))
  if (validos.length === 0) return
  await conn.execute(
    `UPDATE movimientos SET deleted_at = NOW() WHERE id IN (${validos.map(() => '?').join(', ')}) AND deleted_at IS NULL`,
    validos,
  )
}

async function conTransaccion<T>(fn: (conn: any) => Promise<T>): Promise<T> {
  const conn = await getConnection()
  try {
    await conn.beginTransaction()
    const resultado = await fn(conn)
    await conn.commit()
    return resultado
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}

async function bloquearPrestamo(conn: any, id: number) {
  const [filas]: any = await conn.execute(
    'SELECT * FROM prestamos_sucursales WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
    [id],
  )
  if (filas.length === 0) throw new PrestamoError(404, 'Préstamo no encontrado')
  return filas[0]
}

async function totalesDevoluciones(conn: any, prestamoId: number) {
  const [filas]: any = await conn.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN estado = 'confirmada' THEN monto END), 0) AS devuelto,
       COALESCE(SUM(CASE WHEN estado = 'por_confirmar' THEN monto END), 0) AS por_confirmar
     FROM prestamos_devoluciones WHERE prestamo_id = ?`,
    [prestamoId],
  )
  return { devuelto: Number(filas[0].devuelto), porConfirmar: Number(filas[0].por_confirmar) }
}

const comentario = (descripcion: string | null, prestamoId: number) =>
  [descripcion, `Préstamo #${prestamoId}`].filter(Boolean).join(' · ')

// ── Préstamos ───────────────────────────────────────────────────

export async function crearPrestamo(user: Usuario, body: any) {
  const presta = Number(body.sucursal_presta_id)
  const recibe = Number(body.sucursal_recibe_id)
  if (!presta || !recibe) throw new PrestamoError(400, 'Faltan las sucursales')
  if (presta === recibe) throw new PrestamoError(400, 'La sucursal que presta tiene que ser otra')
  await exigirAcceso(user, recibe)

  const monto = parseMonto(body.monto)
  const moneda = parseMoneda(body.moneda)
  const fecha = parseFecha(body.fecha)
  const descripcion =
    String(body.descripcion ?? '')
      .trim()
      .slice(0, 255) || null
  const directo = await puedeAprobarEn(user, presta)

  return conTransaccion(async conn => {
    await exigirSucursalActiva(conn, presta)
    await exigirSucursalActiva(conn, recibe)
    const sale = await parseTramo(body.caja_salida, body.banco_salida_id, 'salida', conn)
    const entra = await parseTramo(body.caja_entrada, body.banco_entrada_id, 'entrada', conn)

    const [res]: any = await conn.execute(
      `INSERT INTO prestamos_sucursales
       (sucursal_presta_id, sucursal_recibe_id, monto, moneda, descripcion, estado, caja_salida, banco_salida_id,
        caja_entrada, banco_entrada_id, user_solicita_id)
       VALUES (?, ?, ?, ?, ?, 'solicitado', ?, ?, ?, ?, ?)`,
      [presta, recibe, monto, moneda, descripcion, sale.caja, sale.bancoId, entra.caja, entra.bancoId, user.id],
    )
    const id = res.insertId
    if (directo) await aceptarDentro(conn, user, await bloquearPrestamo(conn, id), { fecha, bancoSalidaId: null })
    return { id, directo }
  })
}

async function aceptarDentro(
  conn: any,
  user: Usuario,
  p: any,
  opciones: { fecha: string; bancoSalidaId: number | null },
) {
  const sale: Tramo = {
    caja: p.caja_salida,
    bancoId: p.caja_salida === 'banco' ? (opciones.bancoSalidaId ?? p.banco_salida_id) : null,
  }
  if (sale.caja === 'banco') await parseTramo('banco', sale.bancoId, 'salida', conn)
  const [nombrePresta, nombreRecibe] = [
    await nombreSucursal(conn, p.sucursal_presta_id),
    await nombreSucursal(conn, p.sucursal_recibe_id),
  ]
  const movs = await crearMovimientos(conn, {
    sucursalSale: p.sucursal_presta_id,
    sucursalEntra: p.sucursal_recibe_id,
    sale,
    entra: { caja: p.caja_entrada, bancoId: p.banco_entrada_id },
    monto: Number(p.monto),
    moneda: p.moneda,
    fecha: opciones.fecha,
    conceptoSale: `Préstamo a ${nombreRecibe}`,
    conceptoEntra: `Préstamo de ${nombrePresta}`,
    comentarios: comentario(p.descripcion, p.id),
    userId: user.id,
  })
  await conn.execute(
    `UPDATE prestamos_sucursales
     SET estado = 'vigente', fecha = ?, banco_salida_id = ?, user_resuelve_id = ?, resuelto_at = NOW(),
         movimiento_salida_id = ?, movimiento_entrada_id = ?
     WHERE id = ?`,
    [opciones.fecha, sale.bancoId, user.id, movs.salida, movs.entrada, p.id],
  )
}

export async function aceptarPrestamo(user: Usuario, id: number, body: any) {
  const fecha = parseFecha(body.fecha)
  const bancoSalidaId = body.banco_salida_id ? Number(body.banco_salida_id) : null
  return conTransaccion(async conn => {
    const p = await bloquearPrestamo(conn, id)
    await exigirAprobacion(user, p.sucursal_presta_id)
    if (p.estado !== 'solicitado') throw new PrestamoError(409, 'Este pedido ya fue resuelto')
    await aceptarDentro(conn, user, p, { fecha, bancoSalidaId })
    return { id }
  })
}

export async function rechazarPrestamo(user: Usuario, id: number, body: any) {
  const motivo = String(body.motivo ?? '')
    .trim()
    .slice(0, 255)
  if (!motivo) throw new PrestamoError(400, 'Indicá el motivo del rechazo')
  return conTransaccion(async conn => {
    const p = await bloquearPrestamo(conn, id)
    await exigirAprobacion(user, p.sucursal_presta_id)
    if (p.estado !== 'solicitado') throw new PrestamoError(409, 'Este pedido ya fue resuelto')
    await conn.execute(
      `UPDATE prestamos_sucursales SET estado = 'rechazado', motivo_rechazo = ?, user_resuelve_id = ?, resuelto_at = NOW()
       WHERE id = ?`,
      [motivo, user.id, id],
    )
    return { id }
  })
}

export async function cancelarPrestamo(user: Usuario, id: number) {
  return conTransaccion(async conn => {
    const p = await bloquearPrestamo(conn, id)
    if (p.user_solicita_id !== user.id && !(await esSuperadmin(user.rol_id))) {
      throw new PrestamoError(403, 'Solo quien hizo el pedido puede cancelarlo')
    }
    if (p.estado !== 'solicitado') throw new PrestamoError(409, 'Solo se puede cancelar un pedido sin resolver')
    // Un pedido retirado queda "anulado": "cancelado" es solo para el préstamo ya devuelto del todo
    await conn.execute("UPDATE prestamos_sucursales SET estado = 'anulado', resuelto_at = NOW() WHERE id = ?", [id])
    return { id }
  })
}

/** Anula un préstamo vigente sin devoluciones: revierte sus dos movimientos. */
export async function anularPrestamo(user: Usuario, id: number) {
  return conTransaccion(async conn => {
    const p = await bloquearPrestamo(conn, id)
    await exigirAprobacion(user, p.sucursal_presta_id)
    await exigirAprobacion(user, p.sucursal_recibe_id)
    if (p.estado !== 'vigente') throw new PrestamoError(409, 'Solo se puede anular un préstamo vigente')
    const { devuelto, porConfirmar } = await totalesDevoluciones(conn, id)
    if (devuelto > 0 || porConfirmar > 0) {
      throw new PrestamoError(409, 'El préstamo tiene devoluciones: anulá o rechazá primero esas devoluciones')
    }
    await anularMovimientos(conn, [p.movimiento_salida_id, p.movimiento_entrada_id])
    await conn.execute(
      "UPDATE prestamos_sucursales SET estado = 'anulado', user_resuelve_id = ?, resuelto_at = NOW() WHERE id = ?",
      [user.id, id],
    )
    return { id }
  })
}

// ── Devoluciones ────────────────────────────────────────────────

export async function crearDevolucion(user: Usuario, prestamoId: number, body: any) {
  const monto = parseMonto(body.monto)
  const fecha = parseFecha(body.fecha)
  return conTransaccion(async conn => {
    const p = await bloquearPrestamo(conn, prestamoId)
    await exigirAcceso(user, p.sucursal_recibe_id)
    if (p.estado !== 'vigente') throw new PrestamoError(409, 'Solo se puede devolver un préstamo vigente')
    const { devuelto, porConfirmar } = await totalesDevoluciones(conn, prestamoId)
    const disponible = redondear(Number(p.monto) - devuelto - porConfirmar)
    if (monto > disponible) {
      throw new PrestamoError(
        400,
        porConfirmar > 0
          ? `El monto supera lo pendiente (${disponible}); hay devoluciones esperando confirmación`
          : `El monto supera lo pendiente (${disponible})`,
      )
    }
    const sale = await parseTramo(body.caja_salida, body.banco_salida_id, 'salida', conn)
    const entra = await parseTramo(body.caja_entrada, body.banco_entrada_id, 'entrada', conn)
    const [res]: any = await conn.execute(
      `INSERT INTO prestamos_devoluciones
       (prestamo_id, monto, estado, fecha, caja_salida, banco_salida_id, caja_entrada, banco_entrada_id, user_solicita_id)
       VALUES (?, ?, 'por_confirmar', ?, ?, ?, ?, ?, ?)`,
      [prestamoId, monto, fecha, sale.caja, sale.bancoId, entra.caja, entra.bancoId, user.id],
    )
    const id = res.insertId
    const directo = await puedeAprobarEn(user, p.sucursal_presta_id)
    if (directo)
      await confirmarDentro(conn, user, p, await bloquearDevolucion(conn, id), { fecha, bancoEntradaId: null })
    return { id, directo }
  })
}

async function bloquearDevolucion(conn: any, id: number) {
  const [filas]: any = await conn.execute('SELECT * FROM prestamos_devoluciones WHERE id = ? FOR UPDATE', [id])
  if (filas.length === 0) throw new PrestamoError(404, 'Devolución no encontrada')
  return filas[0]
}

async function confirmarDentro(
  conn: any,
  user: Usuario,
  p: any,
  d: any,
  opciones: { fecha: string; bancoEntradaId: number | null },
) {
  const entra: Tramo = {
    caja: d.caja_entrada,
    bancoId: d.caja_entrada === 'banco' ? (opciones.bancoEntradaId ?? d.banco_entrada_id) : null,
  }
  if (entra.caja === 'banco') await parseTramo('banco', entra.bancoId, 'entrada', conn)
  const [nombrePresta, nombreRecibe] = [
    await nombreSucursal(conn, p.sucursal_presta_id),
    await nombreSucursal(conn, p.sucursal_recibe_id),
  ]
  const movs = await crearMovimientos(conn, {
    sucursalSale: p.sucursal_recibe_id,
    sucursalEntra: p.sucursal_presta_id,
    sale: { caja: d.caja_salida, bancoId: d.banco_salida_id },
    entra,
    monto: Number(d.monto),
    moneda: p.moneda,
    fecha: opciones.fecha,
    conceptoSale: `Devolución de préstamo a ${nombrePresta}`,
    conceptoEntra: `Devolución de préstamo de ${nombreRecibe}`,
    comentarios: comentario(p.descripcion, p.id),
    userId: user.id,
  })
  await conn.execute(
    `UPDATE prestamos_devoluciones
     SET estado = 'confirmada', fecha = ?, banco_entrada_id = ?, user_resuelve_id = ?, resuelto_at = NOW(),
         movimiento_salida_id = ?, movimiento_entrada_id = ?
     WHERE id = ?`,
    [opciones.fecha, entra.bancoId, user.id, movs.salida, movs.entrada, d.id],
  )
  await recalcularEstado(conn, p)
}

/** Vigente ↔ cancelado según lo que quede pendiente. */
async function recalcularEstado(conn: any, p: any) {
  const { devuelto } = await totalesDevoluciones(conn, p.id)
  const pendiente = redondear(Number(p.monto) - devuelto)
  const nuevo = pendiente <= 0 ? 'cancelado' : 'vigente'
  await conn.execute("UPDATE prestamos_sucursales SET estado = ? WHERE id = ? AND estado IN ('vigente', 'cancelado')", [
    nuevo,
    p.id,
  ])
}

export async function confirmarDevolucion(user: Usuario, id: number, body: any) {
  const fecha = parseFecha(body.fecha)
  const bancoEntradaId = body.banco_entrada_id ? Number(body.banco_entrada_id) : null
  return conTransaccion(async conn => {
    const d = await bloquearDevolucion(conn, id)
    const p = await bloquearPrestamo(conn, d.prestamo_id)
    await exigirAprobacion(user, p.sucursal_presta_id)
    if (d.estado !== 'por_confirmar') throw new PrestamoError(409, 'Esta devolución ya fue resuelta')
    await confirmarDentro(conn, user, p, d, { fecha, bancoEntradaId })
    return { id }
  })
}

export async function rechazarDevolucion(user: Usuario, id: number, body: any) {
  const motivo = String(body.motivo ?? '')
    .trim()
    .slice(0, 255)
  if (!motivo) throw new PrestamoError(400, 'Indicá el motivo del rechazo')
  return conTransaccion(async conn => {
    const d = await bloquearDevolucion(conn, id)
    const p = await bloquearPrestamo(conn, d.prestamo_id)
    await exigirAprobacion(user, p.sucursal_presta_id)
    if (d.estado !== 'por_confirmar') throw new PrestamoError(409, 'Esta devolución ya fue resuelta')
    await conn.execute(
      `UPDATE prestamos_devoluciones SET estado = 'rechazada', motivo_rechazo = ?, user_resuelve_id = ?, resuelto_at = NOW()
       WHERE id = ?`,
      [motivo, user.id, id],
    )
    return { id }
  })
}

/** Anula una devolución confirmada: revierte sus movimientos y el pendiente vuelve a subir. */
export async function anularDevolucion(user: Usuario, id: number) {
  return conTransaccion(async conn => {
    const d = await bloquearDevolucion(conn, id)
    const p = await bloquearPrestamo(conn, d.prestamo_id)
    await exigirAprobacion(user, p.sucursal_presta_id)
    await exigirAprobacion(user, p.sucursal_recibe_id)
    if (d.estado !== 'confirmada') throw new PrestamoError(409, 'Solo se puede anular una devolución confirmada')
    await anularMovimientos(conn, [d.movimiento_salida_id, d.movimiento_entrada_id])
    await conn.execute(
      "UPDATE prestamos_devoluciones SET estado = 'anulada', user_resuelve_id = ?, resuelto_at = NOW() WHERE id = ?",
      [user.id, id],
    )
    await recalcularEstado(conn, p)
    return { id }
  })
}

// ── Consultas ───────────────────────────────────────────────────

const SELECT_PRESTAMO = `
  SELECT p.*, sp.nombre AS sucursal_presta_nombre, sr.nombre AS sucursal_recibe_nombre,
         bs.nombre AS banco_salida_nombre, be.nombre AS banco_entrada_nombre,
         us.nombre AS usuario_solicita_nombre, ur.nombre AS usuario_resuelve_nombre,
         COALESCE((SELECT SUM(d.monto) FROM prestamos_devoluciones d
                   WHERE d.prestamo_id = p.id AND d.estado = 'confirmada'), 0) AS devuelto,
         COALESCE((SELECT SUM(d.monto) FROM prestamos_devoluciones d
                   WHERE d.prestamo_id = p.id AND d.estado = 'por_confirmar'), 0) AS por_confirmar
  FROM prestamos_sucursales p
  JOIN sucursales sp ON sp.id = p.sucursal_presta_id
  JOIN sucursales sr ON sr.id = p.sucursal_recibe_id
  LEFT JOIN bancos bs ON bs.id = p.banco_salida_id
  LEFT JOIN bancos be ON be.id = p.banco_entrada_id
  LEFT JOIN usuarios us ON us.id = p.user_solicita_id
  LEFT JOIN usuarios ur ON ur.id = p.user_resuelve_id`

function formatearPrestamo(p: any) {
  const monto = Number(p.monto)
  const devuelto = Number(p.devuelto)
  return {
    ...p,
    monto,
    devuelto,
    por_confirmar: Number(p.por_confirmar),
    pendiente: ['vigente', 'cancelado'].includes(p.estado) ? redondear(monto - devuelto) : 0,
    es_apertura: Boolean(p.es_apertura),
    fecha: p.fecha ? formatearFechaRespuesta(p.fecha) : null,
  }
}

/** Todos los préstamos donde participa la sucursal (como prestamista o como deudora), con sus devoluciones. */
export async function estadoDeCuenta(user: Usuario, sucursalId: number, moneda?: string) {
  await exigirAcceso(user, sucursalId)
  const filtroMoneda = moneda === 'USD' || moneda === 'ARS' ? 'AND p.moneda = ?' : ''
  const params: (number | string)[] = [sucursalId, sucursalId]
  if (filtroMoneda) params.push(moneda as string)
  const prestamos: any = await query(
    `${SELECT_PRESTAMO}
     WHERE p.deleted_at IS NULL AND (p.sucursal_presta_id = ? OR p.sucursal_recibe_id = ?) ${filtroMoneda}
     ORDER BY p.fecha_solicitud DESC`,
    params,
  )
  const ids = prestamos.map((p: any) => p.id)
  const devoluciones: any = ids.length
    ? await query(
        `SELECT d.*, us.nombre AS usuario_solicita_nombre, ur.nombre AS usuario_resuelve_nombre
         FROM prestamos_devoluciones d
         LEFT JOIN usuarios us ON us.id = d.user_solicita_id
         LEFT JOIN usuarios ur ON ur.id = d.user_resuelve_id
         WHERE d.prestamo_id IN (${ids.map(() => '?').join(', ')})
         ORDER BY d.created_at ASC`,
        ids,
      )
    : []
  return prestamos.map((p: any) => ({
    ...formatearPrestamo(p),
    devoluciones: devoluciones
      .filter((d: any) => d.prestamo_id === p.id)
      .map((d: any) => ({ ...d, monto: Number(d.monto), fecha: formatearFechaRespuesta(d.fecha) })),
  }))
}

/** Pedidos y devoluciones que esperan que esta sucursal los acepte, en la caja y moneda indicadas. */
export async function porConfirmar(user: Usuario, sucursalId: number, caja: string, moneda: string) {
  await exigirAcceso(user, sucursalId)
  const c = parseCaja(caja, 'la caja')
  const m = parseMoneda(moneda)
  const pedidos: any = await query(
    `${SELECT_PRESTAMO}
     WHERE p.deleted_at IS NULL AND p.estado = 'solicitado' AND p.sucursal_presta_id = ? AND p.caja_salida = ?
       AND p.moneda = ?
     ORDER BY p.fecha_solicitud ASC`,
    [sucursalId, c, m],
  )
  const devoluciones: any = await query(
    `SELECT d.*, p.sucursal_recibe_id, sr.nombre AS sucursal_recibe_nombre, p.descripcion AS prestamo_descripcion,
            p.monto AS prestamo_monto, be.nombre AS banco_entrada_nombre, us.nombre AS usuario_solicita_nombre
     FROM prestamos_devoluciones d
     JOIN prestamos_sucursales p ON p.id = d.prestamo_id
     JOIN sucursales sr ON sr.id = p.sucursal_recibe_id
     LEFT JOIN bancos be ON be.id = d.banco_entrada_id
     LEFT JOIN usuarios us ON us.id = d.user_solicita_id
     WHERE d.estado = 'por_confirmar' AND p.sucursal_presta_id = ? AND d.caja_entrada = ? AND p.moneda = ?
       AND p.deleted_at IS NULL
     ORDER BY d.created_at ASC`,
    [sucursalId, c, m],
  )
  return {
    pedidos: pedidos.map(formatearPrestamo),
    devoluciones: devoluciones.map((d: any) => ({
      ...d,
      monto: Number(d.monto),
      prestamo_monto: Number(d.prestamo_monto),
      fecha: formatearFechaRespuesta(d.fecha),
    })),
  }
}

/** Préstamos vigentes que la sucursal todavía debe (para el formulario de devolución). */
export async function pendientesDeDevolver(user: Usuario, sucursalId: number, moneda: string) {
  await exigirAcceso(user, sucursalId)
  const prestamos: any = await query(
    `${SELECT_PRESTAMO}
     WHERE p.deleted_at IS NULL AND p.estado = 'vigente' AND p.sucursal_recibe_id = ? AND p.moneda = ?
     ORDER BY sp.nombre, p.fecha`,
    [sucursalId, parseMoneda(moneda)],
  )
  return prestamos
    .map(formatearPrestamo)
    .map((p: any) => ({ ...p, disponible: redondear(p.pendiente - p.por_confirmar) }))
    .filter((p: any) => p.disponible > 0)
}

/** Sucursales activas para elegir a quién pedirle (todas, no solo las del usuario). */
export async function sucursalesActivas() {
  return query('SELECT id, nombre FROM sucursales WHERE deleted_at IS NULL AND activo = 1 ORDER BY nombre', [])
}
