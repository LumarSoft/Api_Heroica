import type { ItemCrudo } from './types'

/**
 * Cliente de la API pública de Bistrosoft (ar-api.bistrosoft.com).
 *
 *   POST /api/v1/Token                    → { token, expiration }
 *   GET  /api/v1/TransactionDetailReport  → { records, totalPages, pageSize, totalCount, items[] }
 *
 * Límites de la API: 12 req/min por usuario (429 si se excede). Páginas de hasta 5000 ítems.
 *
 * IMPORTANTE (validado con datos reales): `endDate` es EXCLUSIVO. startDate=D&endDate=D
 * devuelve vacío; un día D se pide como startDate=D&endDate=D+1.
 * Las llamadas se serializan con un intervalo mínimo para no pasarnos nunca del límite.
 * Corre en serverless: un 429 NO se espera acá (consumiría el tiempo de la función);
 * se lanza `BistrosoftLimiteError` y la sincronización retoma en la próxima invocación.
 */

const DEFAULT_BASE_URL = 'https://ar-api.bistrosoft.com'
const INTERVALO_MIN_MS = 5_500 // 60s / 12 req ≈ 5s, con margen
const TIMEOUT_MS = 60_000
const MAX_REINTENTOS = 3
const MARGEN_EXPIRACION_MS = 2 * 60_000
const MAX_PAGINAS = 40 // corte de seguridad: 200.000 ítems por día

interface TokenCache {
  token: string
  expiraAt: number
}

export interface PaginaTransacciones {
  items: ItemCrudo[]
  totalPages: number
  totalCount: number
}

export class BistrosoftError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'BistrosoftError'
  }
}

/** La API limitó las consultas: hay que retomar más tarde, no es una falla de datos. */
export class BistrosoftLimiteError extends BistrosoftError {
  constructor() {
    super('Bistrosoft limitó las consultas (429). Se retoma en la próxima ejecución.', 429)
    this.name = 'BistrosoftLimiteError'
  }
}

let tokenCache: TokenCache | null = null
let ultimaLlamadaAt = 0
let colaLlamadas: Promise<void> = Promise.resolve()

const esperar = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * El ritmo entre llamadas se comparte entre instancias serverless vía la base: quien
 * toma el candado de la fuente carga la última llamada registrada y la devuelve al soltarlo.
 */
export function registrarUltimaLlamada(ms: number | null): void {
  if (ms !== null && ms > ultimaLlamadaAt) ultimaLlamadaAt = ms
}

export function obtenerUltimaLlamada(): number {
  return ultimaLlamadaAt
}

function getBaseUrl(): string {
  return (process.env.BISTROSOFT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function bistrosoftConfigurado(): boolean {
  return Boolean(process.env.BISTROSOFT_USERNAME && process.env.BISTROSOFT_PASSWORD)
}

/** Reserva el próximo turno respetando el intervalo mínimo entre llamadas. */
function reservarTurno(): Promise<void> {
  const turno = colaLlamadas.then(async () => {
    const espera = ultimaLlamadaAt + INTERVALO_MIN_MS - Date.now()
    if (espera > 0) await esperar(espera)
    ultimaLlamadaAt = Date.now()
  })
  colaLlamadas = turno.catch(() => undefined)
  return turno
}

async function fetchConTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ejecuta una llamada respetando el rate limit, con reintentos ante 429, 5xx y
 * errores de red. Los 4xx restantes no se reintentan: son errores de datos o credenciales.
 */
async function llamar(url: string, init: RequestInit): Promise<Response> {
  let ultimoError: unknown = null

  for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
    await reservarTurno()
    try {
      const response = await fetchConTimeout(url, init)
      if (response.status === 429) throw new BistrosoftLimiteError()
      if (response.status >= 500) {
        ultimoError = new BistrosoftError(`Bistrosoft respondió ${response.status}`, response.status)
        await esperar(intento * 5_000)
        continue
      }
      return response
    } catch (err: unknown) {
      if (err instanceof BistrosoftLimiteError) throw err
      ultimoError = err
      await esperar(intento * 5_000)
    }
  }

  if (ultimoError instanceof Error) throw ultimoError
  throw new BistrosoftError('No se pudo conectar con Bistrosoft')
}

async function obtenerToken(forzar = false): Promise<string> {
  if (!forzar && tokenCache && tokenCache.expiraAt - MARGEN_EXPIRACION_MS > Date.now()) {
    return tokenCache.token
  }
  if (!bistrosoftConfigurado()) {
    throw new BistrosoftError('Faltan las credenciales de Bistrosoft (BISTROSOFT_USERNAME / BISTROSOFT_PASSWORD)')
  }

  const response = await llamar(`${getBaseUrl()}/api/v1/Token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.BISTROSOFT_USERNAME,
      password: process.env.BISTROSOFT_PASSWORD,
    }),
  })

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new BistrosoftError('Bistrosoft rechazó las credenciales configuradas', response.status)
  }
  if (!response.ok) {
    throw new BistrosoftError(`Error al autenticar con Bistrosoft (${response.status})`, response.status)
  }

  const data = (await response.json()) as { token?: unknown; expiration?: unknown }
  if (typeof data.token !== 'string' || data.token.length === 0) {
    throw new BistrosoftError('Bistrosoft no devolvió un token válido')
  }

  const expiraAt = typeof data.expiration === 'string' ? Date.parse(data.expiration) : NaN
  tokenCache = {
    token: data.token,
    // Si no informa expiración, lo renovamos a los 30 minutos por las dudas.
    expiraAt: Number.isFinite(expiraAt) ? expiraAt : Date.now() + 30 * 60_000,
  }
  return tokenCache.token
}

function parsearPagina(json: unknown): PaginaTransacciones {
  // La API documenta un envelope paginado; toleramos también un array plano.
  if (Array.isArray(json)) {
    return { items: json as ItemCrudo[], totalPages: 1, totalCount: json.length }
  }
  if (!json || typeof json !== 'object') {
    throw new BistrosoftError('Respuesta inesperada de TransactionDetailReport')
  }
  // Envelope: { records, totalPages, pageSize, totalCount, items[] }
  const envelope = json as { items?: unknown; totalPages?: unknown; totalCount?: unknown }
  const items = envelope.items
  if (!Array.isArray(items)) {
    throw new BistrosoftError('TransactionDetailReport no devolvió la lista de ítems')
  }
  const totalPages = Number(envelope.totalPages)
  const totalCount = Number(envelope.totalCount)
  return {
    items: items as ItemCrudo[],
    totalPages: Number.isFinite(totalPages) ? totalPages : 1,
    totalCount: Number.isFinite(totalCount) ? totalCount : items.length,
  }
}

async function obtenerPagina(desde: string, hasta: string, pagina: number, shopCode?: string) {
  const params = new URLSearchParams({ startDate: desde, endDate: hasta, pageNumber: String(pagina) })
  if (shopCode) params.set('shopCode', shopCode)
  const url = `${getBaseUrl()}/api/v1/TransactionDetailReport?${params.toString()}`

  let token = await obtenerToken()
  let response = await llamar(url, { headers: { Authorization: `Bearer ${token}` } })

  // Token vencido o revocado antes de lo informado: se renueva una sola vez.
  if (response.status === 401) {
    token = await obtenerToken(true)
    response = await llamar(url, { headers: { Authorization: `Bearer ${token}` } })
  }
  if (!response.ok) {
    throw new BistrosoftError(`TransactionDetailReport respondió ${response.status}`, response.status)
  }
  return parsearPagina(await response.json())
}

/** YYYY-MM-DD del día siguiente (endDate exclusivo de la API). */
function diaSiguiente(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Todas las páginas de UN día operativo. Devuelve ítems solo si el recorrido fue completo. */
export async function obtenerTransaccionesDelDia(dia: string): Promise<{ items: ItemCrudo[]; paginas: number }> {
  const items: ItemCrudo[] = []
  let totalPaginas = 1

  for (let pagina = 0; pagina < totalPaginas; pagina++) {
    const resultado = await obtenerPagina(dia, diaSiguiente(dia), pagina)
    totalPaginas = Math.min(Math.max(resultado.totalPages, 1), MAX_PAGINAS)
    items.push(...resultado.items)
    if (resultado.items.length === 0) break
  }

  return { items, paginas: totalPaginas }
}

/** Primera página cruda de un día: sirve para validar el mapeo con datos reales. */
export async function obtenerMuestra(dia: string): Promise<PaginaTransacciones> {
  return obtenerPagina(dia, diaSiguiente(dia), 0)
}
