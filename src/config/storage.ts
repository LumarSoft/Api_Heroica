import path from 'path'

// Dónde se guardan los archivos que suben los usuarios.
//   STORAGE_DRIVER=blob  → Vercel Blob
//   STORAGE_DRIVER=local → carpeta uploads/ del servidor
// Sin la variable se mantiene el comportamiento histórico: Blob en producción y disco en desarrollo.
const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase()

export const usaBlob: boolean = driver === 'blob' || (driver !== 'local' && isProduction)

const RAIZ_PROYECTO = path.resolve(__dirname, '../..')
const UPLOADS_DIR = path.join(RAIZ_PROYECTO, 'uploads')

// Los archivos de Blob se registran en la base con su URL completa; los locales, como "uploads/...".
export function esArchivoRemoto(ruta: string): boolean {
  return /^https?:\/\//i.test(ruta)
}

// Convierte una ruta "uploads/..." de la base en una ruta absoluta.
// Devuelve null si la ruta apunta fuera de la carpeta uploads/.
export function resolverArchivoLocal(ruta: string): string | null {
  const relativa = ruta.replace(/^\/+/, '')
  const absoluta = path.resolve(RAIZ_PROYECTO, relativa)
  if (!relativa.startsWith('uploads/') || !absoluta.startsWith(`${UPLOADS_DIR}${path.sep}`)) return null
  return absoluta
}
