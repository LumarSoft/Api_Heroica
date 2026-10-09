/**
 * Cliente del Bridge de ICG para Hiopos / HiOffice.
 *
 * Dos servidores distintos (ver "Manual del Bridge ICG para desarrolladores"):
 *   1. CloudLicense (global): GET /services/cloud/getCustomerWithAuthToken?email&password
 *      → XML con `address` (servidor asignado al cliente) y `authToken`.
 *   2. Servidor asignado (ErpCloud): todo lo demás, con el header `x-auth-token`.
 *        POST /ErpCloud/exportation/getExportationDashboardFilters/<exportationId>
 *        POST /ErpCloud/exportation/launch  { exportationId, startDate, endDate, filters }
 *        GET  /ErpCloud/session/logout
 *
 * Trampas que maneja este cliente (todas verificadas por quien escribió el manual):
 *   - Las credenciales inválidas vienen con HTTP 200 y un <serverError> en el XML.
 *   - El `address` puede cambiar: se resuelve en cada login, nunca se guarda.
 *   - No hay refresh: una sesión por corrida, re-login ante 401 y logout siempre.
 *   - La sesión muere por inactividad (~10-15 min): por eso no se reutiliza entre corridas.
 *   - Un launch con un attributeId que el dashboard no tiene responde 200 con 0 bytes:
 *     es un error de configuración, distinto de `[]` (rango sin documentos).
 *   - En los endpoints /bridge-back/ el fallo de auth viene como 500 "Authentication failed".
 */

const DEFAULT_CLOUDLICENSE_URL = 'https://cloudlicense.icg.eu'
const TIMEOUT_LOGIN_MS = 20_000
const TIMEOUT_LAUNCH_MS = 45_000
const INTERVALO_MIN_MS = 500

export type TipoErrorHiopos = 'credenciales' | 'configuracion' | 'red' | 'servidor' | 'licencia'

export class HioposError extends Error {
  constructor(
    message: string,
    public readonly tipo: TipoErrorHiopos,
    public readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'HioposError'
  }
}

/** Un filtro de la plantilla del dashboard. Solo `value` / `value2` se pueden cambiar. */
export interface FiltroDashboard {
  attributeId: number
  arithmeticOperator: string
  type: string
  value?: string
  value2?: string
  [extra: string]: unknown
}

/** Documento exportado: `data` en Base64; type 1=csv 2=pdf 3=txt 4=json 5=xml. */
export interface DocumentoExportado {
  name: string
  data: string
  type: number
}

export interface ParametrosLaunch {
  exportationId: string
  /** YYYY-MM-DD: filtra por Fecha del Documento. Obligatorio (sin él el server devuelve []). */
  startDate: string
  endDate?: string
  filters?: FiltroDashboard[]
}

export interface ResultadoLaunch {
  documentos: DocumentoExportado[]
  /** true si el servidor respondió 200 con body vacío (0 bytes). */
  bodyVacio: boolean
  bytes: number
}

export function hioposConfigurado(): boolean {
  return Boolean(process.env.HIOPOS_EMAIL && process.env.HIOPOS_PASSWORD)
}

function cloudLicenseUrl(): string {
  return (process.env.HIOPOS_CLOUDLICENSE_URL || DEFAULT_CLOUDLICENSE_URL).replace(/\/+$/, '')
}

const esperar = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function fetchConTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err: unknown) {
    const abortado = err instanceof Error && err.name === 'AbortError'
    throw new HioposError(
      abortado
        ? 'Hiopos no respondió a tiempo'
        : `No se pudo conectar con Hiopos (${err instanceof Error ? err.message : 'error de red'})`,
      'red',
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Valor de un tag XML a cualquier profundidad (el login viene envuelto en <response>). */
export function valorXml(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  if (!m) return null
  const valor = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
  return valor || null
}

export interface DatosLogin {
  baseUrl: string
  token: string
  customerId: string | null
}

/** Interpreta la respuesta XML del login. Exportada para poder probarla sin red. */
export function interpretarLogin(xml: string): DatosLogin {
  const error = valorXml(xml, 'serverError')
  if (error !== null || /<serverError/i.test(xml)) {
    const codigo = valorXml(xml, 'code')
    const mensaje = valorXml(xml, 'message')
    throw new HioposError(
      codigo === '6'
        ? 'Hiopos rechazó el email o la contraseña configurados (HIOPOS_EMAIL / HIOPOS_PASSWORD)'
        : `Hiopos devolvió un error al iniciar sesión${codigo ? ` (código ${codigo})` : ''}${mensaje ? `: ${mensaje}` : ''}`,
      codigo === '6' ? 'credenciales' : 'servidor',
    )
  }

  const address = valorXml(xml, 'address')
  const token = valorXml(xml, 'authToken')
  if (!address || !token) {
    throw new HioposError('La respuesta del login de Hiopos no trae servidor ni token', 'servidor')
  }

  const secure = (valorXml(xml, 'secure') ?? 'true').toLowerCase() !== 'false'
  const port = valorXml(xml, 'port')
  const protocolo = secure ? 'https' : 'http'
  const puertoDefault = secure ? '443' : '80'
  const host = address.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  const conPuerto = port && port !== puertoDefault && !host.includes(':') ? `${host}:${port}` : host

  return { baseUrl: `${protocolo}://${conPuerto}`, token, customerId: valorXml(xml, 'customerId') }
}

/**
 * Una sesión del Bridge. Uso:
 *   const sesion = new HioposSesion(); try { await sesion.launch(...) } finally { await sesion.cerrar() }
 * El login se hace solo en la primera llamada. Ante un 401 (o el 500 "Authentication
 * failed" de /bridge-back/) se re-loguea una vez y reintenta.
 */
export class HioposSesion {
  private datos: DatosLogin | null = null
  private ultimaLlamada = 0

  get servidor(): string | null {
    return this.datos?.baseUrl ?? null
  }

  async login(): Promise<DatosLogin> {
    if (!hioposConfigurado()) {
      throw new HioposError(
        'Faltan las credenciales de Hiopos en el servidor (HIOPOS_EMAIL / HIOPOS_PASSWORD)',
        'credenciales',
      )
    }
    const params = new URLSearchParams({
      email: process.env.HIOPOS_EMAIL ?? '',
      password: process.env.HIOPOS_PASSWORD ?? '',
      isoCode: 'ES',
    })
    // Sí: es un GET con la contraseña en la query. Así lo define ICG.
    const response = await fetchConTimeout(
      `${cloudLicenseUrl()}/services/cloud/getCustomerWithAuthToken?${params.toString()}`,
      { method: 'GET', headers: { Accept: 'application/xml, text/xml, */*' } },
      TIMEOUT_LOGIN_MS,
    )
    const xml = await response.text()
    if (!response.ok) {
      throw new HioposError(`CloudLicense respondió ${response.status} al iniciar sesión`, 'servidor', response.status)
    }
    this.datos = interpretarLogin(xml)
    return this.datos
  }

  private async turno(): Promise<void> {
    const espera = this.ultimaLlamada + INTERVALO_MIN_MS - Date.now()
    if (espera > 0) await esperar(espera)
    this.ultimaLlamada = Date.now()
  }

  private async llamar(ruta: string, init: RequestInit, timeoutMs: number, reintentarAuth = true): Promise<Response> {
    if (!this.datos) await this.login()
    await this.turno()
    const datos = this.datos as DatosLogin
    const response = await fetchConTimeout(
      `${datos.baseUrl}${ruta}`,
      { ...init, headers: { ...(init.headers ?? {}), 'x-auth-token': datos.token } },
      timeoutMs,
    )

    if (reintentarAuth && (await esFalloDeAuth(response))) {
      // Token muerto (expiró por inactividad o se cerró): re-login (re-resuelve el
      // address por si ICG movió al cliente de servidor) y un único reintento.
      this.datos = null
      await this.login()
      return this.llamar(ruta, init, timeoutMs, false)
    }
    if (await esFalloDeAuth(response)) {
      throw new HioposError(
        'Hiopos rechazó la sesión aun después de volver a iniciarla',
        'credenciales',
        response.status,
      )
    }
    return response
  }

  /** Plantilla de filtros del dashboard (descubrimiento: attributeId, operador y tipo, sin nombres). */
  async obtenerFiltros(exportationId: string): Promise<FiltroDashboard[]> {
    const response = await this.llamar(
      `/ErpCloud/exportation/getExportationDashboardFilters/${encodeURIComponent(exportationId)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      TIMEOUT_LOGIN_MS,
    )
    const texto = await response.text()
    if (!response.ok) {
      throw new HioposError(
        response.status === 404
          ? 'Hiopos no encuentra ese dashboard de exportación: revisá el exportationId'
          : `Hiopos respondió ${response.status} al pedir los filtros del dashboard`,
        response.status === 404 ? 'configuracion' : 'servidor',
        response.status,
      )
    }
    if (!texto.trim()) {
      throw new HioposError(
        'Hiopos devolvió una respuesta vacía al pedir los filtros: el exportationId no existe o el módulo de exportación no está licenciado',
        'configuracion',
      )
    }
    const json = JSON.parse(texto) as unknown
    if (!Array.isArray(json)) return []
    return json.filter(
      (f): f is FiltroDashboard => Boolean(f) && typeof (f as FiltroDashboard).attributeId === 'number',
    )
  }

  /** Ejecuta el export. La respuesta viene envuelta en un array, con los docs en Base64. */
  async launch(parametros: ParametrosLaunch): Promise<ResultadoLaunch> {
    const body: Record<string, unknown> = {
      exportationId: parametros.exportationId,
      startDate: parametros.startDate,
      filters: parametros.filters ?? [],
    }
    if (parametros.endDate) body.endDate = parametros.endDate

    const response = await this.llamar(
      '/ErpCloud/exportation/launch',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      TIMEOUT_LAUNCH_MS,
    )
    const texto = await response.text()
    if (!response.ok) {
      throw new HioposError(
        response.status === 404
          ? 'Hiopos no encuentra el dashboard de exportación configurado'
          : `Hiopos respondió ${response.status} al exportar ventas`,
        response.status === 404 ? 'configuracion' : 'servidor',
        response.status,
      )
    }
    if (texto.length === 0) return { documentos: [], bodyVacio: true, bytes: 0 }

    let json: unknown
    try {
      json = JSON.parse(texto)
    } catch {
      throw new HioposError('La respuesta del export de Hiopos no es JSON válido', 'servidor')
    }
    const envoltorios = Array.isArray(json) ? json : [json]
    const documentos: DocumentoExportado[] = []
    for (const envoltorio of envoltorios) {
      const docs = (envoltorio as { exportedDocs?: unknown } | null)?.exportedDocs
      if (!Array.isArray(docs)) continue
      for (const d of docs) {
        const doc = d as Partial<DocumentoExportado>
        if (typeof doc.data === 'string') {
          documentos.push({ name: String(doc.name ?? ''), data: doc.data, type: Number(doc.type ?? 0) })
        }
      }
    }
    return { documentos, bodyVacio: false, bytes: texto.length }
  }

  /** Logout: barato y evita sesiones colgadas. Nunca lanza. */
  async cerrar(): Promise<void> {
    if (!this.datos) return
    const { baseUrl, token } = this.datos
    this.datos = null
    try {
      await fetchConTimeout(
        `${baseUrl}/ErpCloud/session/logout`,
        { method: 'GET', headers: { 'x-auth-token': token } },
        10_000,
      )
    } catch {
      // Si falla el logout la sesión muere sola por inactividad.
    }
  }
}

async function esFalloDeAuth(response: Response): Promise<boolean> {
  if (response.status === 401) return true
  if (response.status !== 500) return false
  const texto = await response
    .clone()
    .text()
    .catch(() => '')
  return texto.includes('Authentication failed')
}

/** Epoch ms como string, que es el formato que exige el filtro Datetime. */
export function epochMsTexto(ms: number): string {
  return String(Math.trunc(ms))
}
