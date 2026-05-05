import type { Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { put } from '@vercel/blob'

const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

const storage = isProduction
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/solicitudes')
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
        cb(null, uploadDir)
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
        cb(null, `solic-${uniqueSuffix}${path.extname(file.originalname)}`)
      },
    })

export const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true)
    else cb(new Error('Solo se permiten archivos PDF'))
  },
  limits: { fileSize: 10 * 1024 * 1024 },
})

export const uploadSolicitudArchivo = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se proporcionó ningún archivo' })
    }

    let url: string

    if (isProduction) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN no configurado')
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
      const ext = path.extname(req.file.originalname)
      const blob = await put(`solicitudes/solic-${uniqueSuffix}${ext}`, req.file.buffer, {
        access: 'private',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      })
      url = blob.url
    } else {
      url = `uploads/solicitudes/${(req.file as Express.Multer.File & { filename: string }).filename}`
    }

    res.json({
      success: true,
      data: {
        url,
        nombre_original: req.file.originalname,
        tamano_bytes: req.file.size,
      },
    })
  } catch (error) {
    console.error('Error al subir archivo de solicitud:', error)
    if (!isProduction && req.file && (req.file as any).path) {
      try { fs.unlinkSync((req.file as any).path) } catch { /* ignore */ }
    }
    res.status(500).json({ success: false, message: 'Error al subir el archivo' })
  }
}
