import type { Request, Response } from 'express'
import {
  createMotivoBaja,
  deleteMotivoBaja,
  existsMotivoBajaNombre,
  getMotivoBajaById,
  listMotivosBaja,
  updateMotivoBaja,
} from '../services/rrhhMotivosBajaService'
import { query } from '../config/database'
import { normalizeOptionalText } from '../services/rrhhSolicitudesService'
import { verificarAccesoSucursal } from '../services/rrhhSolicitudesService'

export async function getMotivosBajaPorSucursal(req: Request, res: Response) {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const sucursalId = Number(req.query.sucursal_id)
    if (!Number.isFinite(sucursalId) || sucursalId <= 0) {
      return res.status(400).json({ success: false, message: 'sucursal_id es requerido' })
    }

    if (!(await verificarAccesoSucursal(user as { id: number; rol_id: number }, sucursalId))) {
      return res.status(403).json({ success: false, message: 'Sin acceso a esta sucursal' })
    }

    const lista = await listMotivosBaja(sucursalId, true)
    res.json({
      success: true,
      data: lista.map(r => ({ id: r.id, sucursal_id: r.sucursal_id, nombre: r.nombre, orden: r.orden })),
    })
  } catch (error) {
    console.error('Error al listar motivos de baja:', error)
    res.status(500).json({ success: false, message: 'Error al listar motivos de baja' })
  }
}

export async function postMotivoBaja(req: Request, res: Response) {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const sucursalId = Number(req.body.sucursal_id)
    const nombre = normalizeOptionalText(req.body.nombre)
    if (!Number.isFinite(sucursalId) || sucursalId <= 0) {
      return res.status(400).json({ success: false, message: 'sucursal_id es requerido' })
    }
    if (!nombre || nombre.length < 2) {
      return res.status(400).json({ success: false, message: 'Ingrese un nombre de motivo (mínimo 2 caracteres)' })
    }

    if (!(await verificarAccesoSucursal(user as { id: number; rol_id: number }, sucursalId))) {
      return res.status(403).json({ success: false, message: 'Sin acceso a esta sucursal' })
    }

    if (await existsMotivoBajaNombre(sucursalId, nombre)) {
      return res.status(409).json({ success: false, message: 'Ya existe un motivo con ese nombre en esta sucursal' })
    }

    const creado = await createMotivoBaja(sucursalId, nombre)
    res.status(201).json({ success: true, data: creado })
  } catch (error) {
    console.error('Error al crear motivo de baja:', error)
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Error al crear motivo' })
  }
}

export async function putMotivoBaja(req: Request, res: Response) {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const id = Number(req.params.id)
    const sucursalId = Number(req.body.sucursal_id)
    const nombre = normalizeOptionalText(req.body.nombre)

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'id es requerido' })
    }
    if (!Number.isFinite(sucursalId) || sucursalId <= 0) {
      return res.status(400).json({ success: false, message: 'sucursal_id es requerido' })
    }
    if (!nombre || nombre.length < 2) {
      return res.status(400).json({ success: false, message: 'Ingrese un nombre de motivo (mínimo 2 caracteres)' })
    }

    if (!(await verificarAccesoSucursal(user as { id: number; rol_id: number }, sucursalId))) {
      return res.status(403).json({ success: false, message: 'Sin acceso a esta sucursal' })
    }

    const existing = await getMotivoBajaById(id, sucursalId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Motivo no encontrado en esta sucursal' })
    }

    if (await existsMotivoBajaNombre(sucursalId, nombre, id)) {
      return res.status(409).json({ success: false, message: 'Ya existe otro motivo con ese nombre' })
    }

    const actualizado = await updateMotivoBaja(id, sucursalId, nombre)
    res.json({ success: true, data: actualizado })
  } catch (error) {
    console.error('Error al actualizar motivo de baja:', error)
    res
      .status(500)
      .json({ success: false, message: error instanceof Error ? error.message : 'Error al actualizar motivo' })
  }
}

export async function deleteMotivoBajaCtrl(req: Request, res: Response) {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    }

    const id = Number(req.params.id)
    const sucursalId = Number(req.query.sucursal_id)

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'id es requerido' })
    }
    if (!Number.isFinite(sucursalId) || sucursalId <= 0) {
      return res.status(400).json({ success: false, message: 'sucursal_id es requerido' })
    }

    if (!(await verificarAccesoSucursal(user as { id: number; rol_id: number }, sucursalId))) {
      return res.status(403).json({ success: false, message: 'Sin acceso a esta sucursal' })
    }

    const existing = await getMotivoBajaById(id, sucursalId)
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Motivo no encontrado en esta sucursal' })
    }

    const usos = (await query(
      `SELECT COUNT(*) AS total FROM rrhh_solicitudes
       WHERE tipo = 'Bajas'
         AND deleted_at IS NULL
         AND JSON_EXTRACT(detalles, '$.motivo_baja_id') = ?`,
      [id],
    )) as Array<{ total: number }>
    const total = Number(usos[0]?.total ?? 0)
    if (total > 0) {
      return res.status(409).json({
        success: false,
        message: `No se puede eliminar: el motivo está usado en ${total} solicitud${total === 1 ? '' : 'es'} de baja`,
      })
    }

    await deleteMotivoBaja(id, sucursalId)
    res.json({ success: true, message: 'Motivo eliminado' })
  } catch (error) {
    console.error('Error al eliminar motivo de baja:', error)
    res
      .status(500)
      .json({ success: false, message: error instanceof Error ? error.message : 'Error al eliminar motivo' })
  }
}
