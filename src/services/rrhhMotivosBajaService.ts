import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { query } from '../config/database'

export interface MotivoBajaRow extends RowDataPacket {
  id: number
  sucursal_id: number
  nombre: string
  activo: number
  orden: number
}

export async function listMotivosBaja(sucursalId: number, soloActivos = true): Promise<MotivoBajaRow[]> {
  const rows = (await query(
    `SELECT id, sucursal_id, nombre, activo, orden
     FROM rrhh_motivos_baja
     WHERE sucursal_id = ?
       AND deleted_at IS NULL
       ${soloActivos ? 'AND activo = 1' : ''}
     ORDER BY orden ASC, nombre ASC`,
    [sucursalId],
  )) as MotivoBajaRow[]
  return rows
}

export async function getMotivoBajaActivoEnSucursal(
  connection: PoolConnection,
  sucursalId: number,
  id: number,
): Promise<{ id: number; nombre: string } | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, nombre FROM rrhh_motivos_baja
     WHERE id = ? AND sucursal_id = ? AND activo = 1 AND deleted_at IS NULL`,
    [id, sucursalId],
  )
  if (rows.length === 0) return null
  return { id: Number(rows[0].id), nombre: String(rows[0].nombre) }
}

export async function createMotivoBaja(
  sucursalId: number,
  nombreTrim: string,
): Promise<{ id: number; nombre: string }> {
  const [result] = await query(`INSERT INTO rrhh_motivos_baja (sucursal_id, nombre, orden) VALUES (?, ?, 100)`, [
    sucursalId,
    nombreTrim,
  ])
  const insertId = Number((result as { insertId: number }).insertId)
  return { id: insertId, nombre: nombreTrim }
}

export async function getMotivoBajaById(
  id: number,
  sucursalId: number,
): Promise<{ id: number; sucursal_id: number; nombre: string } | null> {
  const rows = (await query(
    `SELECT id, sucursal_id, nombre FROM rrhh_motivos_baja
     WHERE id = ? AND sucursal_id = ? AND deleted_at IS NULL`,
    [id, sucursalId],
  )) as Array<{ id: number; sucursal_id: number; nombre: string }>
  if (rows.length === 0) return null
  return { id: Number(rows[0].id), sucursal_id: Number(rows[0].sucursal_id), nombre: String(rows[0].nombre) }
}

export async function updateMotivoBaja(
  id: number,
  sucursalId: number,
  nombreTrim: string,
): Promise<{ id: number; nombre: string }> {
  await query(
    `UPDATE rrhh_motivos_baja
     SET nombre = ?
     WHERE id = ? AND sucursal_id = ? AND deleted_at IS NULL`,
    [nombreTrim, id, sucursalId],
  )
  return { id, nombre: nombreTrim }
}

export async function deleteMotivoBaja(id: number, sucursalId: number): Promise<void> {
  await query(
    `UPDATE rrhh_motivos_baja
     SET deleted_at = NOW()
     WHERE id = ? AND sucursal_id = ? AND deleted_at IS NULL`,
    [id, sucursalId],
  )
}

export async function existsMotivoBajaNombre(
  sucursalId: number,
  nombreTrim: string,
  excludeId?: number,
): Promise<boolean> {
  const params: Array<string | number> = [sucursalId, nombreTrim]
  let extra = ''
  if (excludeId) {
    extra = ' AND id != ?'
    params.push(excludeId)
  }
  const rows = (await query(
    `SELECT id FROM rrhh_motivos_baja
     WHERE sucursal_id = ? AND LOWER(nombre) = LOWER(?) AND deleted_at IS NULL${extra}
     LIMIT 1`,
    params,
  )) as Array<{ id: number }>
  return rows.length > 0
}
