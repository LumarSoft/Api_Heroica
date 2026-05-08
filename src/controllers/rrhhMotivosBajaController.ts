import type { Request, Response } from 'express'
import { createMotivoBaja, listMotivosBaja } from '../services/rrhhMotivosBajaService'
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

    const creado = await createMotivoBaja(sucursalId, nombre)
    res.status(201).json({ success: true, data: creado })
  } catch (error) {
    console.error('Error al crear motivo de baja:', error)
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Error al crear motivo' })
  }
}
