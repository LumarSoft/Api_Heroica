import type { Response } from 'express'
import { get } from '@vercel/blob'
import { Readable } from 'stream'
import { esArchivoRemoto, resolverArchivoLocal } from '../config/storage'

function contentDisposition(nombre: string | null): string {
  const safeName = encodeURIComponent(nombre || 'documento')
  return `inline; filename*=UTF-8''${safeName}`
}

export async function sendArchivoPrivado(res: Response, url: string, nombre: string | null): Promise<void> {
  res.setHeader('Content-Disposition', contentDisposition(nombre))
  if (!esArchivoRemoto(url)) {
    const filePath = resolverArchivoLocal(url)
    if (!filePath) throw new Error('Ruta de archivo inválida')
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
