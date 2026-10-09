import crypto from 'crypto'
import type { CampoVenta, MapeoColumnas } from './hioposMapeo'
import type { ItemCrudo, LineaVentaNormalizada } from './types'

/**
 * Convierte las filas del export de HiOffice (una por línea de ticket, con los datos
 * del documento repetidos) en líneas normalizadas:
 *   - cada fila → una línea `producto` (o `descuento` si el artículo es un descuento);
 *   - por cada documento se agrega una línea `pago` (encabezado) con el total del
 *     ticket y su forma de pago, que es lo que usan los KPIs de tickets y medios de pago.
 * Un documento con estado "anulado" se marca anulado entero (no suma en el panel).
 */

const MS_HORA = 3_600_000
/** Argentina no tiene horario de verano: UTC-3 fijo. */
const OFFSET_ARGENTINA_MS = -3 * MS_HORA
const MESES: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
  ene: '01',
  abr: '04',
  ago: '08',
  dic: '12',
}
/** Columnas con datos personales de clientes que no se guardan en `raw`. */
const COLUMNAS_PRIVADAS = /cliente|email|mail|telefono|tel[eé]fono|dni|cuit|cuil|nif|direcci[oó]n|domicilio/i
const ESTADO_ANULADO = /anulad|void|cancelad|eliminad|borrad/i

function valor(fila: ItemCrudo, mapeo: MapeoColumnas, campo: CampoVenta): unknown {
  const columna = mapeo[campo]
  return columna ? fila[columna] : undefined
}

export function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v !== 'string') return null
  const limpio = v.trim()
  return limpio && limpio !== '-' ? limpio : null
}

/**
 * Número tolerante a formatos: 1234.5 · "1,234.50" (ICG) · "1.234,50" (es-AR) · "$ 1.234" · "-12,5".
 * Con un solo separador: la coma seguida de exactamente 3 dígitos se toma como miles.
 */
export function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.trim().replace(/[$\s]|ARS/gi, '')
  if (!s) return null
  const negativo = /^\(.*\)$/.test(s) // (123,45) contable
  s = s.replace(/[()]/g, '')
  const coma = s.lastIndexOf(',')
  const punto = s.lastIndexOf('.')
  if (coma >= 0 && punto >= 0) {
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (coma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

function dosDigitos(n: number | string): string {
  return String(n).padStart(2, '0')
}

function desdeEpoch(ms: number): { fecha: string; hora: string } {
  const iso = new Date(ms + OFFSET_ARGENTINA_MS).toISOString()
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 19) }
}

/** Epoch en ms a partir de un valor de fecha (para la marca de agua). */
export function aEpochMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e11 ? v : v * 1000
  const t = texto(v)
  if (!t) return null
  if (/^\d{12,14}$/.test(t)) return Number(t)
  if (/^\d{9,11}$/.test(t)) return Number(t) * 1000
  const partes = fechaYHora(t)
  if (!partes) return null
  return Date.parse(`${partes.fecha}T${partes.hora ?? '00:00:00'}Z`) - OFFSET_ARGENTINA_MS
}

/**
 * Fecha (y hora si viene) en hora Argentina. Acepta epoch (s o ms), ISO, "YYYY-MM-DD HH:mm",
 * "dd/mm/yyyy [HH:mm[:ss]]", "dd-mm-yyyy" y el toString de Java ("Mon Jul 11 00:00:00 CEST 2016").
 */
export function fechaYHora(v: unknown): { fecha: string; hora: string | null } | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1e8) {
    return desdeEpoch(v > 1e11 ? v : v * 1000)
  }
  const t = texto(v)
  if (!t) return null
  if (/^\d{12,14}$/.test(t)) return desdeEpoch(Number(t))
  if (/^\d{9,11}$/.test(t)) return desdeEpoch(Number(t) * 1000)

  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/)
  if (m) {
    if (m[7] && m[4]) return desdeEpoch(Date.parse(t))
    return { fecha: `${m[1]}-${m[2]}-${m[3]}`, hora: m[4] ? `${m[4]}:${m[5]}:${m[6] ?? '00'}` : null }
  }
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    return {
      fecha: `${m[3]}-${dosDigitos(m[2])}-${dosDigitos(m[1])}`,
      hora: m[4] ? `${dosDigitos(m[4])}:${m[5]}:${m[6] ?? '00'}` : null,
    }
  }
  m = t.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+\S+\s+(\d{4})$/)
  if (m && MESES[m[1].toLowerCase()]) {
    return { fecha: `${m[4]}-${MESES[m[1].toLowerCase()]}-${dosDigitos(m[2])}`, hora: m[3] }
  }
  return null
}

/** "14:35", "14:35:10", "1435", una fecha con hora o un epoch → HH:mm:ss. */
export function soloHora(v: unknown): string | null {
  const t = texto(v)
  if (!t) return null
  let m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (m) return `${dosDigitos(m[1])}:${m[2]}:${m[3] ?? '00'}`
  m = t.match(/^(\d{2})(\d{2})$/)
  if (m) return `${m[1]}:${m[2]}:00`
  return fechaYHora(v)?.hora ?? null
}

function sinDatosPrivados(fila: ItemCrudo): ItemCrudo {
  return Object.fromEntries(Object.entries(fila).filter(([k]) => !COLUMNAS_PRIVADAS.test(k)))
}

function recortarId(id: string): string {
  if (id.length <= 100) return id
  return `h:${crypto.createHash('sha1').update(id).digest('hex')}`
}

export interface RechazoFila {
  motivo: string
  raw: ItemCrudo
}

export interface ResultadoNormalizacionHiopos {
  lineas: LineaVentaNormalizada[]
  rechazadas: RechazoFila[]
  documentos: number
}

export function normalizarFilasHiopos(filas: ItemCrudo[], mapeo: MapeoColumnas): ResultadoNormalizacionHiopos {
  const productos: LineaVentaNormalizada[] = []
  const rechazadas: RechazoFila[] = []

  for (const fila of filas) {
    const cuando = fechaYHora(valor(fila, mapeo, 'fecha'))
    if (!cuando) {
      rechazadas.push({ motivo: 'Sin fecha de documento reconocible', raw: fila })
      continue
    }
    const cantidadLeida = numero(valor(fila, mapeo, 'cantidad'))
    const precio = numero(valor(fila, mapeo, 'precioUnitario'))
    let importe = numero(valor(fila, mapeo, 'importe'))
    if (importe === null && cantidadLeida !== null && precio !== null)
      importe = Math.round(cantidadLeida * precio * 100) / 100
    if (importe === null) {
      rechazadas.push({ motivo: 'Sin importe reconocible', raw: fila })
      continue
    }

    const guid = texto(valor(fila, mapeo, 'documentoGuid'))
    const serie = texto(valor(fila, mapeo, 'serie'))
    const numeroDoc = texto(valor(fila, mapeo, 'numero'))
    const localCodigo = texto(valor(fila, mapeo, 'localCodigo'))
    const localNombre = texto(valor(fila, mapeo, 'localNombre'))
    const documento = numeroDoc ? (serie ? `${serie}-${numeroDoc}` : numeroDoc) : null
    if (!guid && !documento) {
      rechazadas.push({ motivo: 'Sin número ni GUID de documento', raw: fila })
      continue
    }
    // Sin GUID, el número puede repetirse entre locales: se agrega el local a la clave.
    const transaccionId = recortarId(guid ?? `${localCodigo ?? localNombre ?? 'local'}|${documento}|${cuando.fecha}`)

    const hora = soloHora(valor(fila, mapeo, 'hora')) ?? cuando.hora
    const nombreProducto = texto(valor(fila, mapeo, 'productoNombre'))
    const esDescuento = Boolean(nombreProducto && /^descuento|^dto\b|bonificaci/i.test(nombreProducto)) && importe <= 0
    const descuentoLinea = numero(valor(fila, mapeo, 'descuento'))

    productos.push({
      localCodigo: localCodigo ?? localNombre,
      localNombre: localNombre ?? localCodigo,
      transaccionId,
      documento,
      tipoDocumento: texto(valor(fila, mapeo, 'tipoDocumento')),
      fecha: cuando.fecha,
      fechaHora: hora ? `${cuando.fecha} ${hora}` : null,
      modificadoMs: aEpochMs(valor(fila, mapeo, 'fechaModificado')),
      tipoLinea: esDescuento ? 'descuento' : 'producto',
      productoCodigo: texto(valor(fila, mapeo, 'productoCodigo')),
      productoNombre: nombreProducto ?? (esDescuento ? 'Descuento' : 'Sin artículo'),
      categoria: texto(valor(fila, mapeo, 'categoria')),
      cantidad: esDescuento ? 0 : (cantidadLeida ?? 1),
      precioUnitario: precio,
      importe,
      descuento: esDescuento ? -importe : Math.abs(descuentoLinea ?? 0),
      medioPago: texto(valor(fila, mapeo, 'medioPago')),
      canal: texto(valor(fila, mapeo, 'canal')),
      vendedor: texto(valor(fila, mapeo, 'vendedor')),
      caja: texto(valor(fila, mapeo, 'caja')),
      estadoOrigen: texto(valor(fila, mapeo, 'estado')),
      anulada: false,
      raw: sinDatosPrivados(fila),
    })
  }

  // Agrupar por documento: anulación y encabezado de pago.
  const porDocumento = new Map<string, LineaVentaNormalizada[]>()
  for (const l of productos) {
    const grupo = porDocumento.get(l.transaccionId)
    if (grupo) grupo.push(l)
    else porDocumento.set(l.transaccionId, [l])
  }

  const lineas: LineaVentaNormalizada[] = []
  for (const [transaccionId, grupo] of porDocumento) {
    const anulada = grupo.some(l => l.estadoOrigen !== null && ESTADO_ANULADO.test(l.estadoOrigen))
    for (const l of grupo) l.anulada = anulada
    lineas.push(...grupo)

    const primera = grupo[0]
    const medios = [...new Set(grupo.map(l => l.medioPago).filter((m): m is string => Boolean(m)))]
    const momentos = grupo
      .map(l => l.fechaHora)
      .filter((f): f is string => Boolean(f))
      .sort()
    const modificados = grupo.map(l => l.modificadoMs).filter((m): m is number => m !== null)
    const total = Math.round(grupo.reduce((acc, l) => acc + l.importe, 0) * 100) / 100

    lineas.push({
      ...primera,
      transaccionId,
      fechaHora: momentos[0] ?? null,
      modificadoMs: modificados.length ? Math.max(...modificados) : null,
      tipoLinea: 'pago',
      productoCodigo: null,
      productoNombre: null,
      categoria: null,
      cantidad: 0,
      precioUnitario: null,
      importe: total,
      descuento: 0,
      // Pago combinado sin importe por forma de pago en el export: se informa junto.
      medioPago: medios.length === 0 ? null : medios.length === 1 ? medios[0] : medios.sort().join(' + '),
      anulada,
      raw: { encabezado: true, documento: primera.documento, lineas: grupo.length },
    })
  }

  return { lineas, rechazadas, documentos: porDocumento.size }
}
