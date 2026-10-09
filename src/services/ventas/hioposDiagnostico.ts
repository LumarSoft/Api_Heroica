import { HioposError, HioposSesion, hioposConfigurado, hioposCustomerId, type FiltroDashboard } from './hioposClient'
import { decodificarDocumentos } from './hioposDecoder'
import {
  detectarColumnas,
  detectarFiltroFechaModificado,
  detectarMapeo,
  validarMapeo,
  type ColumnaDetectada,
  type ConfigHiopos,
  type MapeoColumnas,
} from './hioposMapeo'
import { normalizarFilasHiopos } from './hioposNormalizer'
import type { LineaVentaNormalizada } from './types'

/**
 * Diagnóstico de punta a punta contra el Bridge, siguiendo el "cómo investigar" del
 * manual: login → plantilla de filtros → export de un día conocido → columnas →
 * normalización con el mapeo actual (o el detectado). No escribe ventas.
 */

export interface PasoDiagnostico {
  paso: string
  ok: boolean
  detalle: string
}

export interface ResultadoDiagnostico {
  ok: boolean
  pasos: PasoDiagnostico[]
  servidor: string | null
  filtros: FiltroDashboard[]
  attrFechaModificadoSugerido: number | null
  bytes: number | null
  formato: string | null
  filas: number
  columnas: ColumnaDetectada[]
  mapeoSugerido: MapeoColumnas
  mapeoUsado: MapeoColumnas
  faltantesMapeo: string[]
  documentos: number
  rechazadas: Array<{ motivo: string; cantidad: number }>
  ejemplos: LineaVentaNormalizada[]
}

function sumarDia(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export async function diagnosticarHiopos(config: ConfigHiopos, fecha: string): Promise<ResultadoDiagnostico> {
  const r: ResultadoDiagnostico = {
    ok: false,
    pasos: [],
    servidor: null,
    filtros: [],
    attrFechaModificadoSugerido: null,
    bytes: null,
    formato: null,
    filas: 0,
    columnas: [],
    mapeoSugerido: {},
    mapeoUsado: config.mapeo,
    faltantesMapeo: [],
    documentos: 0,
    rechazadas: [],
    ejemplos: [],
  }
  const paso = (nombre: string, ok: boolean, detalle: string) => r.pasos.push({ paso: nombre, ok, detalle })

  if (!hioposConfigurado()) {
    paso('Credenciales', false, 'Faltan HIOPOS_EMAIL y HIOPOS_PASSWORD en las variables de entorno del servidor.')
    return r
  }
  paso(
    'Credenciales',
    true,
    hioposCustomerId()
      ? `Usuario de HiOffice + empresa ${hioposCustomerId()} (HIOPOS_EMAIL, HIOPOS_PASSWORD, HIOPOS_CUSTOMER_ID).`
      : 'Cliente de CloudLicense (HIOPOS_EMAIL y HIOPOS_PASSWORD).',
  )

  const sesion = new HioposSesion()
  try {
    const login = await sesion.login()
    r.servidor = login.baseUrl
    paso('Login', true, `Sesión iniciada. Servidor asignado: ${login.baseUrl}`)
    if (sesion.servidorCliente?.bridgeExportation === false) {
      paso(
        'Licencia de exportación',
        false,
        'CloudLicense informa bridgeExportation = false: la empresa no tiene habilitado el módulo de exportación por web service (Bridge). Hay que pedirle a Hiopos/ICG que lo active; sin eso el export puede fallar.',
      )
    }

    if (!config.exportationId) {
      paso(
        'Dashboard de exportación',
        false,
        'Falta el exportationId (GUID del dashboard de HiOffice). Cargalo en esta pantalla.',
      )
      return r
    }

    try {
      r.filtros = await sesion.obtenerFiltros(config.exportationId)
      r.attrFechaModificadoSugerido = detectarFiltroFechaModificado(r.filtros)
      paso(
        'Filtros del dashboard',
        true,
        r.filtros.length
          ? `${r.filtros.length} filtros: ${r.filtros.map(f => `${f.attributeId} (${f.type} ${f.arithmeticOperator})`).join(', ')}`
          : 'El dashboard no tiene filtros: se va a importar siempre por rango de días.',
      )
    } catch (err: unknown) {
      paso('Filtros del dashboard', false, err instanceof Error ? err.message : 'No se pudieron leer los filtros')
      if (err instanceof HioposError && err.tipo === 'configuracion') return r
    }

    const launch = await sesion.launch({
      exportationId: config.exportationId,
      startDate: fecha,
      endDate: sumarDia(fecha),
      filters: [],
    })
    r.bytes = launch.bytes
    if (launch.bodyVacio) {
      paso(
        'Export de ventas',
        false,
        'Hiopos respondió 200 con 0 bytes: configuración del dashboard rota o filtro inexistente.',
      )
      return r
    }
    const decodificado = decodificarDocumentos(launch.documentos)
    r.formato = decodificado.formato
    r.filas = decodificado.filas.length
    paso(
      'Export de ventas',
      true,
      decodificado.formato === 'ninguno'
        ? `Llegaron ${launch.documentos.length} documentos pero ninguno en JSON ni CSV: configurá el dashboard para exportar JSON.`
        : `${launch.documentos.length} documento(s) ${decodificado.formato.toUpperCase()}, ${r.filas} filas para el ${fecha}.`,
    )
    if (r.filas === 0) {
      paso(
        'Columnas',
        false,
        'Ese día no trajo filas. Probá con un día en el que seguro hubo ventas (no siempre hay error: [] = sin documentos).',
      )
      return r
    }

    r.columnas = detectarColumnas(decodificado.filas)
    r.mapeoSugerido = detectarMapeo(r.columnas.map(c => c.nombre))
    const mapeoActualValido = validarMapeo(config.mapeo).length === 0
    r.mapeoUsado = mapeoActualValido ? config.mapeo : { ...r.mapeoSugerido, ...config.mapeo }
    r.faltantesMapeo = validarMapeo(r.mapeoUsado)
    paso('Columnas', true, `${r.columnas.length} columnas: ${r.columnas.map(c => c.nombre).join(', ')}`)

    if (r.faltantesMapeo.length > 0) {
      paso('Mapeo de columnas', false, r.faltantesMapeo.join('. '))
      return r
    }
    const normalizado = normalizarFilasHiopos(decodificado.filas, r.mapeoUsado)
    r.documentos = normalizado.documentos
    const motivos = new Map<string, number>()
    for (const x of normalizado.rechazadas) motivos.set(x.motivo, (motivos.get(x.motivo) ?? 0) + 1)
    r.rechazadas = [...motivos.entries()].map(([motivo, cantidad]) => ({ motivo, cantidad }))
    r.ejemplos = normalizado.lineas.slice(0, 12)
    const total = normalizado.lineas
      .filter(l => l.tipoLinea === 'pago' && !l.anulada)
      .reduce((a, l) => a + l.importe, 0)
    paso(
      'Normalización',
      normalizado.lineas.length > 0,
      `${normalizado.documentos} tickets, ${normalizado.lineas.length} líneas, total ${total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}` +
        (normalizado.rechazadas.length ? ` · ${normalizado.rechazadas.length} filas descartadas` : ''),
    )
    r.ok = r.pasos.every(p => p.ok)
    return r
  } catch (err: unknown) {
    paso('Conexión', false, err instanceof Error ? err.message : 'Error desconocido')
    return r
  } finally {
    await sesion.cerrar()
  }
}
