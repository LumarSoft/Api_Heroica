import type { Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { put } from '@vercel/blob'
import { query } from '../config/database'

const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

const storage = isProduction
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/personal')
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
        cb(null, uploadDir)
      },
      filename: (_req, file, cb) => {
        const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
        cb(null, `doc-${suffix}${path.extname(file.originalname)}`)
      },
    })

const MIME_PERMITIDOS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

export const uploadDocumento = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (MIME_PERMITIDOS.has(file.mimetype)) cb(null, true)
    else cb(new Error('Solo se permiten archivos PDF o imagen (JPG, PNG, WebP)'))
  },
  limits: { fileSize: 10 * 1024 * 1024 },
})

// POST /api/personal/:id/documentos
export const createPersonalDocumento = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se proporcionó ningún archivo' })
    }

    const personalId = Number(req.params.id)
    if (!Number.isFinite(personalId) || personalId <= 0) {
      return res.status(400).json({ success: false, message: 'ID inválido' })
    }

    const label = String(req.body.label ?? '').trim()
    if (!label) {
      return res.status(400).json({ success: false, message: 'El campo "label" es requerido' })
    }

    const exists: any = await query(`SELECT id FROM personal WHERE id = ? AND deleted_at IS NULL`, [personalId])
    if (!Array.isArray(exists) || exists.length === 0) {
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }

    let url: string

    if (isProduction) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN no configurado')
      const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
      const ext = path.extname(req.file.originalname)
      const blob = await put(`personal/doc-${suffix}${ext}`, req.file.buffer, {
        access: 'private',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      })
      url = blob.url
    } else {
      url = `uploads/personal/${(req.file as Express.Multer.File & { filename: string }).filename}`
    }

    const user = (req as any).user
    const result: any = await query(
      `INSERT INTO personal_documentos (personal_id, label, url, nombre_original, subido_por_id, subido_por_nombre)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [personalId, label, url, req.file.originalname, user?.id ?? null, user?.nombre ?? null],
    )

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        personal_id: personalId,
        label,
        url,
        nombre_original: req.file.originalname,
        subido_por_nombre: user?.nombre ?? null,
      },
    })
  } catch (error) {
    console.error('Error al subir documento de personal:', error)
    if (!isProduction && req.file && (req.file as any).path) {
      try {
        fs.unlinkSync((req.file as any).path)
      } catch {
        /* ignore */
      }
    }
    res.status(500).json({ success: false, message: 'Error al subir el documento' })
  }
}

// DELETE /api/personal/:id/documentos/:docId
export const deletePersonalDocumento = async (req: Request, res: Response) => {
  try {
    const personalId = Number(req.params.id)
    const docId = Number(req.params.docId)

    if (!Number.isFinite(personalId) || !Number.isFinite(docId)) {
      return res.status(400).json({ success: false, message: 'IDs inválidos' })
    }

    const result: any = await query(
      `UPDATE personal_documentos SET deleted_at = NOW()
       WHERE id = ? AND personal_id = ? AND deleted_at IS NULL`,
      [docId, personalId],
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Documento no encontrado' })
    }

    res.json({ success: true, message: 'Documento eliminado' })
  } catch (error) {
    console.error('Error al eliminar documento de personal:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar el documento' })
  }
}
