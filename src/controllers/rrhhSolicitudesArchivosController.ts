import type { Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { put } from '@vercel/blob'
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'
import { query } from '../config/database'
import { getSolicitudArchivos, verificarAccesoSucursal } from '../services/rrhhSolicitudesService'
import { sendArchivoPrivado } from '../services/archivoPrivadoService'

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

const MIME_SOLICITUD_PERMITIDOS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const MAX_ARCHIVO_SOLICITUD_BYTES = 10 * 1024 * 1024
const EXTENSION_POR_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

export const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (MIME_SOLICITUD_PERMITIDOS.has(file.mimetype)) cb(null, true)
    else cb(new Error('Solo se permiten archivos PDF o imagen (JPG, PNG, WebP)'))
  },
  limits: { fileSize: MAX_ARCHIVO_SOLICITUD_BYTES },
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
  } catch {
    if (!isProduction && req.file?.path) {
      try {
        fs.unlinkSync(req.file.path)
      } catch {
        /* ignore */
      }
    }
    res.status(500).json({ success: false, message: 'Error al subir el archivo' })
  }
}

// POST /api/rrhh/solicitudes/archivos/token
// Vercel corta en 4.5 MB el body de las funciones (413 sin CORS → "Failed to fetch" en el navegador),
// así que en producción el navegador sube el archivo directo a Blob con un token acotado a un único
// pathname, a los tipos permitidos y a 10 MB. En local no hay límite: se usa el upload por multer.
export const createSolicitudArchivoUploadToken = async (req: Request, res: Response) => {
  try {
    if (!isProduction) return res.json({ success: true, data: { modo: 'servidor' } })

    const contentType = typeof req.body.content_type === 'string' ? req.body.content_type : ''
    const tamano = Number(req.body.tamano_bytes)
    if (!MIME_SOLICITUD_PERMITIDOS.has(contentType)) {
      return res
        .status(400)
        .json({ success: false, message: 'Solo se permiten archivos PDF o imagen (JPG, PNG, WebP)' })
    }
    if (!Number.isFinite(tamano) || tamano <= 0) {
      return res.status(400).json({ success: false, message: 'El archivo está vacío o es inválido' })
    }
    if (tamano > MAX_ARCHIVO_SOLICITUD_BYTES) {
      return res.status(400).json({ success: false, message: 'El archivo supera el máximo de 10 MB' })
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN no configurado')

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    const pathname = `solicitudes/solic-${uniqueSuffix}${EXTENSION_POR_MIME[contentType]}`
    const token = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_ARCHIVO_SOLICITUD_BYTES,
      validUntil: Date.now() + 10 * 60 * 1000,
    })

    res.json({ success: true, data: { modo: 'directo', token, pathname } })
  } catch {
    res.status(500).json({ success: false, message: 'No se pudo preparar la subida del archivo' })
  }
}

// POST /api/rrhh/solicitudes/:id/archivos/abrir
export const openSolicitudArchivo = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Usuario no autenticado' })
    const solicitudId = Number(req.params.id)
    const url = typeof req.body.url === 'string' ? req.body.url : ''
    if (!Number.isInteger(solicitudId) || solicitudId <= 0 || !url)
      return res.status(400).json({ success: false, message: 'Archivo inválido' })

    const rows = (await query('SELECT sucursal_id FROM rrhh_solicitudes WHERE id = ? AND deleted_at IS NULL', [
      solicitudId,
    ])) as Array<{ sucursal_id: number }>
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' })
    if (!(await verificarAccesoSucursal(req.user, rows[0].sucursal_id)))
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta solicitud' })

    const archivos = await getSolicitudArchivos(solicitudId)
    const archivo = archivos.find(item => item.url === url)
    if (!archivo) return res.status(404).json({ success: false, message: 'Archivo no encontrado en la solicitud' })
    await sendArchivoPrivado(res, archivo.url, archivo.nombre_original)
  } catch {
    if (!res.headersSent) res.status(500).json({ success: false, message: 'No se pudo abrir el archivo' })
  }
}
