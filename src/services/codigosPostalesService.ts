const CORREO_ARGENTINO_URL = 'https://www.correoargentino.com.ar/sites/all/modules/custom/ca_forms/api/wsFacade.php'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface ProvinciaPostal {
  codigo: string
  nombre: string
}

export interface CodigoPostalOpcion {
  id: string
  localidad: string
  partido: string | null
  codigo_postal: string
}

interface CacheEntry {
  expiresAt: number
  items: CodigoPostalOpcion[]
}

interface CorreoLocalidad {
  id?: unknown
  nombre?: unknown
  partido?: unknown
  cp?: unknown
}

export const PROVINCIAS_POSTALES: ProvinciaPostal[] = [
  { codigo: 'C', nombre: 'Ciudad Autónoma de Buenos Aires' },
  { codigo: 'B', nombre: 'Buenos Aires' },
  { codigo: 'K', nombre: 'Catamarca' },
  { codigo: 'H', nombre: 'Chaco' },
  { codigo: 'U', nombre: 'Chubut' },
  { codigo: 'X', nombre: 'Córdoba' },
  { codigo: 'W', nombre: 'Corrientes' },
  { codigo: 'E', nombre: 'Entre Ríos' },
  { codigo: 'P', nombre: 'Formosa' },
  { codigo: 'Y', nombre: 'Jujuy' },
  { codigo: 'L', nombre: 'La Pampa' },
  { codigo: 'F', nombre: 'La Rioja' },
  { codigo: 'M', nombre: 'Mendoza' },
  { codigo: 'N', nombre: 'Misiones' },
  { codigo: 'Q', nombre: 'Neuquén' },
  { codigo: 'R', nombre: 'Río Negro' },
  { codigo: 'A', nombre: 'Salta' },
  { codigo: 'J', nombre: 'San Juan' },
  { codigo: 'D', nombre: 'San Luis' },
  { codigo: 'Z', nombre: 'Santa Cruz' },
  { codigo: 'S', nombre: 'Santa Fe' },
  { codigo: 'G', nombre: 'Santiago del Estero' },
  { codigo: 'V', nombre: 'Tierra del Fuego' },
  { codigo: 'T', nombre: 'Tucumán' },
]

const codigosProvincia = new Set(PROVINCIAS_POSTALES.map(provincia => provincia.codigo))
const cache = new Map<string, CacheEntry>()

export function isProvinciaPostalCodigo(value: string): boolean {
  return codigosProvincia.has(value.toUpperCase())
}

export function normalizeUbicacionPostal(values: {
  provincia_codigo?: unknown
  localidad?: unknown
  codigo_postal?: unknown
}): { provinciaCodigo: string | null; localidad: string | null; codigoPostal: string | null } {
  const provinciaCodigo =
    typeof values.provincia_codigo === 'string' ? values.provincia_codigo.trim().toUpperCase() : ''
  const localidad = typeof values.localidad === 'string' ? values.localidad.trim() : ''
  const codigoPostal = typeof values.codigo_postal === 'string' ? values.codigo_postal.trim() : ''

  if (!provinciaCodigo && !localidad && !codigoPostal) {
    return { provinciaCodigo: null, localidad: null, codigoPostal: null }
  }
  if (!provinciaCodigo || !localidad || !codigoPostal) {
    throw new Error('Para guardar la ubicación postal, complete provincia, localidad y código postal')
  }
  if (!isProvinciaPostalCodigo(provinciaCodigo)) throw new Error('La provincia indicada no es válida')
  if (localidad.length > 120) throw new Error('La localidad no puede superar los 120 caracteres')
  if (!/^\d{4}$/.test(codigoPostal)) throw new Error('El código postal debe tener exactamente 4 dígitos')

  return { provinciaCodigo, localidad, codigoPostal }
}

function parseCorreoResponse(payload: unknown): CodigoPostalOpcion[] {
  if (!Array.isArray(payload)) throw new Error('La respuesta del catálogo postal no es válida')

  const unique = new Map<string, CodigoPostalOpcion>()
  for (const raw of payload as CorreoLocalidad[]) {
    const localidad = typeof raw.nombre === 'string' ? raw.nombre.trim() : ''
    const codigoPostal = raw.cp == null ? '' : String(raw.cp).trim()
    if (!localidad || !/^\d{4}$/.test(codigoPostal)) continue

    const partido = typeof raw.partido === 'string' && raw.partido.trim() ? raw.partido.trim() : null
    const sourceId = raw.id == null ? localidad : String(raw.id)
    const id = `${sourceId}-${codigoPostal}`
    unique.set(id, { id, localidad, partido, codigo_postal: codigoPostal })
  }

  return [...unique.values()].sort(
    (a, b) =>
      a.localidad.localeCompare(b.localidad, 'es', { sensitivity: 'base' }) ||
      a.codigo_postal.localeCompare(b.codigo_postal),
  )
}

async function fetchFromCorreo(provinciaCodigo: string): Promise<CodigoPostalOpcion[]> {
  const body = new URLSearchParams({
    action: 'localidades',
    localidad: 'none',
    calle: '',
    altura: '',
    provincia: provinciaCodigo,
  })
  const response = await fetch(CORREO_ARGENTINO_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Correo Argentino respondió con estado ${response.status}`)

  const text = (await response.text()).replace(/^\uFEFF/, '')
  return parseCorreoResponse(JSON.parse(text) as unknown)
}

export async function getCodigosPostales(provinciaCodigo: string): Promise<{
  items: CodigoPostalOpcion[]
  stale: boolean
}> {
  const codigo = provinciaCodigo.toUpperCase()
  if (!isProvinciaPostalCodigo(codigo)) throw new Error('La provincia indicada no es válida')

  const cached = cache.get(codigo)
  if (cached && cached.expiresAt > Date.now()) return { items: cached.items, stale: false }

  try {
    const items = await fetchFromCorreo(codigo)
    cache.set(codigo, { expiresAt: Date.now() + CACHE_TTL_MS, items })
    return { items, stale: false }
  } catch (error: unknown) {
    if (cached) return { items: cached.items, stale: true }
    throw error
  }
}
