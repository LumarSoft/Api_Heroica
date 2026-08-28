import type { Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { get, put } from '@vercel/blob'
import { Readable } from 'stream'
import { query } from '../config/database'
import { isTipoDocumentoLegajo, labelForTipoDoc, listArchivosByPersonal } from '../services/personalArchivosService'

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

function contentDisposition(nombre: string | null): string {
  const safeName = encodeURIComponent(nombre || 'documento')
  return `inline; filename*=UTF-8''${safeName}`
}

async function sendArchivoPrivado(res: Response, url: string, nombre: string | null): Promise<void> {
  res.setHeader('Content-Disposition', contentDisposition(nombre))
  if (!/^https?:\/\//i.test(url)) {
    const relativePath = url.replace(/^\/+/, '')
    const uploadsDir = path.resolve(__dirname, '../../uploads')
    const filePath = path.resolve(__dirname, '../..', relativePath)
    if (!relativePath.startsWith('uploads/') || !filePath.startsWith(`${uploadsDir}${path.sep}`)) {
      throw new Error('Ruta de archivo inválida')
    }
    await new Promise<void>((resolve, reject) => {
      res.sendFile(filePath, error => (error ? reject(error) : resolve()))
    })
    return
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN no configurado')
  const blob = await get(url, { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN })
  if (!blob || blob.statusCode !== 200) throw new Error('Archivo no disponible')
  res.setHeader('Content-Type', blob.blob.contentType)
  Readable.fromWeb(blob.stream).pipe(res)
}

// POST /api/personal/:id/archivos/abrir
// Obtiene archivos privados de Vercel Blob con la credencial de la API, sin exponerla al navegador.
export const openPersonalArchivo = async (req: Request, res: Response) => {
  try {
    const personalId = Number(req.params.id)
    const url = typeof req.body.url === 'string' ? req.body.url : ''
    if (!Number.isFinite(personalId) || personalId <= 0 || !url) {
      return res.status(400).json({ success: false, message: 'Archivo inválido' })
    }

    const archivos = await listArchivosByPersonal(personalId)
    const archivo = archivos.find(item => item.url === url)
    if (!archivo) {
      return res.status(404).json({ success: false, message: 'Archivo no encontrado en el legajo' })
    }

    await sendArchivoPrivado(res, archivo.url, archivo.nombre_original)
  } catch (error) {
    console.error('Error al abrir archivo de personal:', error)
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'No se pudo abrir el archivo' })
    }
  }
}

async function validarPersonalConRecibos(personalId: number): Promise<boolean> {
  const rows = (await query(`SELECT id FROM personal WHERE id = ? AND deleted_at IS NULL AND condicion_laboral = 1`, [
    personalId,
  ])) as Array<{ id: number }>
  return rows.length > 0
}

export const getRecibosSueldo = async (req: Request, res: Response) => {
  try {
    const personalId = Number(req.params.id)
    if (!(await validarPersonalConRecibos(personalId)))
      return res.status(403).json({ success: false, message: 'Este colaborador no tiene recibos de sueldo' })
    const mes = req.query.mes ? Number(req.query.mes) : null
    const anio = req.query.anio ? Number(req.query.anio) : null
    const params: Array<number> = [personalId]
    let filtros = 'personal_id = ?'
    if (mes && mes >= 1 && mes <= 12) {
      filtros += ' AND mes = ?'
      params.push(mes)
    }
    if (anio && anio >= 2000) {
      filtros += ' AND anio = ?'
      params.push(anio)
    }
    const data = await query(
      `SELECT id, mes, anio, url, nombre_original, subido_por_nombre, created_at FROM personal_recibos_sueldo WHERE ${filtros} ORDER BY anio DESC, mes DESC, created_at DESC`,
      params,
    )
    res.json({ success: true, data })
  } catch (error) {
    console.error('Error al listar recibos:', error)
    res.status(500).json({ success: false, message: 'Error al listar recibos' })
  }
}

export const createReciboSueldo = async (req: Request, res: Response) => {
  try {
    const personalId = Number(req.params.id)
    const mes = Number(req.body.mes)
    const anio = Number(req.body.anio)
    if (!req.file || !(await validarPersonalConRecibos(personalId)) || mes < 1 || mes > 12 || anio < 2000)
      return res.status(400).json({ success: false, message: 'Datos de recibo inválidos' })
    let url: string
    if (isProduction) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN no configurado')
      const blob = await put(
        `recibos/${personalId}/${Date.now()}${path.extname(req.file.originalname)}`,
        req.file.buffer,
        { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN },
      )
      url = blob.url
    } else {
      url = `uploads/personal/${(req.file as Express.Multer.File & { filename: string }).filename}`
    }
    const user = (req as Request & { user?: { id: number; nombre: string } }).user
    const result = (await query(
      `INSERT INTO personal_recibos_sueldo (personal_id, mes, anio, url, nombre_original, subido_por_id, subido_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [personalId, mes, anio, url, req.file.originalname, user?.id ?? null, user?.nombre ?? null],
    )) as { insertId: number }
    res
      .status(201)
      .json({
        success: true,
        data: {
          id: result.insertId,
          mes,
          anio,
          url,
          nombre_original: req.file.originalname,
          subido_por_nombre: user?.nombre ?? null,
          created_at: new Date().toISOString(),
        },
      })
  } catch (error) {
    console.error('Error al subir recibo:', error)
    res.status(500).json({ success: false, message: 'Error al subir recibo' })
  }
}

export const openReciboSueldo = async (req: Request, res: Response) => {
  try {
    const rows = (await query(
      `SELECT url, nombre_original FROM personal_recibos_sueldo WHERE id = ? AND personal_id = ?`,
      [Number(req.params.reciboId), Number(req.params.id)],
    )) as Array<{ url: string; nombre_original: string | null }>
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Recibo no encontrado' })
    await sendArchivoPrivado(res, rows[0].url, rows[0].nombre_original)
  } catch (error) {
    console.error('Error al abrir recibo:', error)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'No se pudo abrir el recibo' })
  }
}

export const deleteReciboSueldo = async (req: Request, res: Response) => {
  try {
    const result = (await query(`DELETE FROM personal_recibos_sueldo WHERE id = ? AND personal_id = ?`, [
      Number(req.params.reciboId),
      Number(req.params.id),
    ])) as { affectedRows?: number }
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Recibo no encontrado' })
    res.json({ success: true, message: 'Recibo eliminado' })
  } catch (error) {
    console.error('Error al eliminar recibo:', error)
    res.status(500).json({ success: false, message: 'No se pudo eliminar el recibo' })
  }
}

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

    const tipoDoc = String(req.body.tipo_doc ?? '').trim()
    if (!isTipoDocumentoLegajo(tipoDoc)) {
      return res.status(400).json({ success: false, message: 'El tipo de documento no es válido' })
    }
    const label = labelForTipoDoc(tipoDoc)

    const fechaVencimientoRaw = String(req.body.fecha_vencimiento ?? '').trim()
    const fechaVencimiento = fechaVencimientoRaw || null
    if (fechaVencimiento && !/^\d{4}-\d{2}-\d{2}$/.test(fechaVencimiento)) {
      return res.status(400).json({ success: false, message: 'La fecha de vencimiento no es válida' })
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
      `INSERT INTO personal_documentos
       (personal_id, label, tipo_doc, url, nombre_original, fecha_vencimiento, subido_por_id, subido_por_nombre)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        personalId,
        label,
        tipoDoc,
        url,
        req.file.originalname,
        fechaVencimiento,
        user?.id ?? null,
        user?.nombre ?? null,
      ],
    )

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        personal_id: personalId,
        label,
        tipo_doc: tipoDoc,
        url,
        nombre_original: req.file.originalname,
        fecha_vencimiento: fechaVencimiento,
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
