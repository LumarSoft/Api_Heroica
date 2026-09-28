import { head } from '@vercel/blob'
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'
import path from 'path'

export const MAX_ARCHIVO_PERSONAL_BYTES = 10 * 1024 * 1024

export const MIME_ARCHIVO_PERSONAL_PERMITIDOS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

const EXTENSION_POR_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

export type DestinoArchivoPersonal = 'documento' | 'recibo'

function prefijoDestino(personalId: number, destino: DestinoArchivoPersonal): string {
  return destino === 'recibo' ? `recibos/${personalId}/` : `personal/${personalId}/`
}

export function nombreArchivoSeguro(value: unknown): string {
  const nombre = typeof value === 'string' ? path.basename(value).trim() : ''
  return (nombre || 'documento').slice(0, 500)
}

export async function crearTokenArchivoPersonal(
  personalId: number,
  destino: DestinoArchivoPersonal,
  contentType: string,
): Promise<{ token: string; pathname: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN no configurado')

  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
  const prefijoNombre = destino === 'recibo' ? 'recibo' : 'doc'
  const pathname = `${prefijoDestino(personalId, destino)}${prefijoNombre}-${uniqueSuffix}${EXTENSION_POR_MIME[contentType]}`
  const token = await generateClientTokenFromReadWriteToken({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathname,
    allowedContentTypes: [contentType],
    maximumSizeInBytes: MAX_ARCHIVO_PERSONAL_BYTES,
    validUntil: Date.now() + 10 * 60 * 1000,
  })
  return { token, pathname }
}

export async function validarArchivoPersonalDirecto(
  url: string,
  personalId: number,
  destino: DestinoArchivoPersonal,
): Promise<{ url: string; contentType: string; size: number }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN no configurado')

  const metadata = await head(url, { token: process.env.BLOB_READ_WRITE_TOKEN })
  if (metadata.url !== url || !metadata.pathname.startsWith(prefijoDestino(personalId, destino))) {
    throw new Error('El archivo no pertenece al legajo indicado')
  }
  if (!MIME_ARCHIVO_PERSONAL_PERMITIDOS.has(metadata.contentType)) {
    throw new Error('El formato del archivo no está permitido')
  }
  if (metadata.size <= 0 || metadata.size > MAX_ARCHIVO_PERSONAL_BYTES) {
    throw new Error('El archivo supera el máximo de 10 MB')
  }
  return { url: metadata.url, contentType: metadata.contentType, size: metadata.size }
}
