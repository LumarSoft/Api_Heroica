import type { Response } from 'express'
import path from 'path'
import { get } from '@vercel/blob'
import { Readable } from 'stream'

function contentDisposition(nombre: string | null): string {
  const safeName = encodeURIComponent(nombre || 'documento')
  return `inline; filename*=UTF-8''${safeName}`
}

export async function sendArchivoPrivado(res: Response, url: string, nombre: string | null): Promise<void> {
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
