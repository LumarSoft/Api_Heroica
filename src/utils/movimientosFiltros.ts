import { Request } from 'express'

export type SaldoTipo = 'real' | 'necesario' | 'combinado'

export interface FiltrosMovimientos {
  desde: string | null
  hasta: string | null
  q: string | null
  bancoIds: number[]
  deuda: 'todos' | 'solo_deudas' | 'sin_deudas'
  chequesPendientes: boolean
}

export interface Paginacion {
  limit: number
  cursorFecha: string | null
  cursorOrden: number | null
  cursorId: number | null
}

export const LIMIT_DEFAULT = 100
export const LIMIT_MAX = 500

const asString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

const esFechaISO = (v: string | null): boolean => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v)

export const parseFiltros = (req: Request): FiltrosMovimientos => {
  const desde = asString(req.query.desde)
  const hasta = asString(req.query.hasta)
  const bancoIdsRaw = asString(req.query.banco_id)
  const deudaRaw = asString(req.query.deuda)

  return {
    desde: esFechaISO(desde) ? desde : null,
    hasta: esFechaISO(hasta) ? hasta : null,
    q: asString(req.query.q),
    bancoIds: bancoIdsRaw
      ? bancoIdsRaw
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => Number.isInteger(n) && n > 0)
      : [],
    deuda: deudaRaw === 'solo_deudas' || deudaRaw === 'sin_deudas' ? deudaRaw : 'todos',
    chequesPendientes: asString(req.query.cheques_pendientes) === 'true',
  }
}

export const parsePaginacion = (req: Request): Paginacion => {
  const limitRaw = Number(req.query.limit)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), LIMIT_MAX) : LIMIT_DEFAULT

  const cursorFecha = asString(req.query.cursor_fecha)
  const cursorOrdenRaw = Number(req.query.cursor_orden)
  const cursorIdRaw = Number(req.query.cursor_id)

  return {
    limit,
    cursorFecha: esFechaISO(cursorFecha) ? cursorFecha : null,
    cursorOrden: Number.isFinite(cursorOrdenRaw) ? cursorOrdenRaw : null,
    cursorId: Number.isInteger(cursorIdRaw) && cursorIdRaw > 0 ? cursorIdRaw : null,
  }
}

export const parseSaldo = (req: Request): SaldoTipo | null => {
  const v = asString(req.query.saldo)
  return v === 'real' || v === 'necesario' || v === 'combinado' ? v : null
}

export const sqlSaldo = (alias: string, saldo: SaldoTipo): string => {
  if (saldo === 'real') return `${alias}.estado = 'completado'`
  // 'pendiente' = solicitud sin aprobar: pertenece a Pagos Pendientes, no a la caja.
  if (saldo === 'necesario') return `${alias}.estado = 'aprobado'`
  return `${alias}.estado IN ('completado', 'aprobado')`
}

const fechaDesc = (saldo: SaldoTipo): boolean => saldo === 'real'

export const sqlFiltros = (alias: string, f: FiltrosMovimientos): { sql: string; params: unknown[] } => {
  const partes: string[] = []
  const params: unknown[] = []

  if (f.desde) {
    partes.push(`${alias}.fecha >= ?`)
    params.push(f.desde)
  }
  if (f.hasta) {
    partes.push(`${alias}.fecha <= ?`)
    params.push(f.hasta)
  }

  if (f.bancoIds.length > 0) {
    partes.push(`${alias}.banco_id IN (${f.bancoIds.map(() => '?').join(', ')})`)
    params.push(...f.bancoIds)
  }

  if (f.deuda === 'solo_deudas') partes.push(`${alias}.es_deuda = 1`)
  if (f.deuda === 'sin_deudas') partes.push(`(${alias}.es_deuda = 0 OR ${alias}.es_deuda IS NULL)`)

  if (f.chequesPendientes) {
    partes.push(
      `(mp.nombre REGEXP 'cheque|echeq' AND (${alias}.numero_cheque IS NULL OR TRIM(${alias}.numero_cheque) = ''))`,
    )
  }

  if (f.q) {
    if (f.q.startsWith('#')) {
      partes.push(`${alias}.numero_cheque LIKE ?`)
      params.push(`%${f.q.slice(1)}%`)
    } else {
      const like = `%${f.q}%`
      const sinPuntos = `%${f.q.replace(/\./g, '')}%`
      partes.push(
        `(${alias}.concepto LIKE ? OR ${alias}.comentarios LIKE ? OR ${alias}.numero_cheque LIKE ?
          OR ${alias}.comprobante LIKE ? OR d.nombre LIKE ?
          OR FORMAT(ABS(${alias}.monto), 2, 'es_AR') LIKE ?
          OR FORMAT(${alias}.monto, 2, 'es_AR') LIKE ?
          OR REPLACE(FORMAT(ABS(${alias}.monto), 2, 'es_AR'), '.', '') LIKE ?
          OR REPLACE(FORMAT(${alias}.monto, 2, 'es_AR'), '.', '') LIKE ?)`,
      )
      params.push(like, like, like, like, like, like, like, sinPuntos, sinPuntos)
    }
  }

  return { sql: partes.length > 0 ? ` AND ${partes.join(' AND ')}` : '', params }
}

export const sqlCursor = (alias: string, saldo: SaldoTipo, p: Paginacion): { sql: string; params: unknown[] } => {
  if (p.cursorFecha === null || p.cursorOrden === null || p.cursorId === null) {
    return { sql: '', params: [] }
  }
  const cmp = fechaDesc(saldo) ? '<' : '>'
  return {
    sql: ` AND (
      ${alias}.fecha ${cmp} ?
      OR (${alias}.fecha = ? AND COALESCE(${alias}.orden, ${alias}.id) > ?)
      OR (${alias}.fecha = ? AND COALESCE(${alias}.orden, ${alias}.id) = ? AND ${alias}.id > ?)
    )`,
    params: [p.cursorFecha, p.cursorFecha, p.cursorOrden, p.cursorFecha, p.cursorOrden, p.cursorId],
  }
}

export const sqlOrderBy = (alias: string, saldo: SaldoTipo): string =>
  ` ORDER BY ${alias}.fecha ${fechaDesc(saldo) ? 'DESC' : 'ASC'}, COALESCE(${alias}.orden, ${alias}.id) ASC, ${alias}.id ASC`

export const construirCursor = (ultimo: { fecha: unknown; orden: unknown; id: number } | undefined) => {
  if (!ultimo) return null
  const fecha =
    ultimo.fecha instanceof Date
      ? `${ultimo.fecha.getFullYear()}-${String(ultimo.fecha.getMonth() + 1).padStart(2, '0')}-${String(ultimo.fecha.getDate()).padStart(2, '0')}`
      : String(ultimo.fecha).slice(0, 10)
  return {
    cursor_fecha: fecha,
    cursor_orden: ultimo.orden === null || ultimo.orden === undefined ? ultimo.id : Number(ultimo.orden),
    cursor_id: ultimo.id,
  }
}
