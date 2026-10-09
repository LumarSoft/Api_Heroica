import type { DocumentoExportado } from './hioposClient'
import type { ItemCrudo } from './types'

/**
 * Convierte los documentos de un launch del Bridge en filas (un objeto por fila).
 *
 *  - `data` viene en Base64; se usa el doc JSON (type 4) y, si no hay, el CSV (type 1).
 *  - ICG emite números con coma de miles sin comillas ("Total": 43,500.06), que rompen
 *    JSON.parse: se sanean antes de parsear.
 *  - El JSON puede ser un array de objetos o el formato con `headers` + `rows` del
 *    ExportationExecute; ambos terminan como filas { columna: valor }.
 */

const TIPO_CSV = 1
const TIPO_JSON = 4

export class FormatoExportError extends Error {}

/**
 * Quita la coma de miles de los números que están fuera de strings.
 * Por defecto solo toca valores de objeto (después de ":"), donde no hay ambigüedad;
 * `agresivo` también los de arrays (ahí "1,234" podría ser dos números: se usa solo
 * si el modo seguro no alcanzó para que el JSON sea válido).
 */
export function sanitizarMiles(json: string, agresivo = false): string {
  const numeroConMiles = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  let salida = ''
  let enString = false
  let ultimoSignificativo = ''

  for (let i = 0; i < json.length; ) {
    const c = json[i]
    if (enString) {
      salida += c
      if (c === '\\') {
        salida += json[i + 1] ?? ''
        i += 2
        continue
      }
      if (c === '"') {
        enString = false
        ultimoSignificativo = '"'
      }
      i++
      continue
    }
    if (c === '"') {
      enString = true
      salida += c
      i++
      continue
    }
    if (
      (c === '-' || (c >= '0' && c <= '9')) &&
      (ultimoSignificativo === ':' || (agresivo && (ultimoSignificativo === '[' || ultimoSignificativo === ',')))
    ) {
      numeroConMiles.lastIndex = i
      const m = numeroConMiles.exec(json)
      if (m) {
        // Solo si el número termina donde termina el valor (no "1,234abc").
        const siguiente = json.slice(i + m[0].length).match(/^\s*([,}\]])/)
        if (siguiente) {
          salida += m[0].replace(/,/g, '')
          i += m[0].length
          ultimoSignificativo = '0'
          continue
        }
      }
    }
    salida += c
    if (!/\s/.test(c)) ultimoSignificativo = c
    i++
  }
  return salida
}

export function parsearJsonExport(texto: string): unknown {
  const limpio = texto.replace(/^﻿/, '').trim()
  if (!limpio) return []
  for (const candidato of [limpio, sanitizarMiles(limpio), sanitizarMiles(limpio, true)]) {
    try {
      return JSON.parse(candidato)
    } catch {
      // probamos la siguiente variante
    }
  }
  throw new FormatoExportError(
    'El JSON exportado por Hiopos no se pudo interpretar ni saneando los separadores de miles',
  )
}

function nombreHeader(header: unknown, indice: number): string {
  if (header && typeof header === 'object') {
    const h = header as Record<string, unknown>
    for (const clave of ['name', 'caption', 'title', 'attributeName', 'metricName', 'label', 'columnName']) {
      if (typeof h[clave] === 'string' && (h[clave] as string).trim()) return (h[clave] as string).trim()
    }
    if (typeof h.attributeId === 'number' && h.attributeId > 0) return `Atributo ${h.attributeId}`
    if (typeof h.metricId === 'number' && h.metricId > 0) return `Métrica ${h.metricId}`
  }
  if (typeof header === 'string' && header.trim()) return header.trim()
  return `Columna ${indice + 1}`
}

/** Lleva cualquiera de las formas conocidas del export a un array de filas. */
export function aFilas(json: unknown): ItemCrudo[] {
  if (Array.isArray(json)) {
    if (json.length === 0) return []
    if (json.every(f => f && typeof f === 'object' && !Array.isArray(f))) return json as ItemCrudo[]
    // Array de arrays: la primera fila son los nombres de columna.
    if (json.every(Array.isArray)) {
      const [cabecera, ...filas] = json as unknown[][]
      const nombres = cabecera.map((h, i) => nombreHeader(h, i))
      return filas.map(f => Object.fromEntries(nombres.map((n, i) => [n, f[i] ?? null])))
    }
    throw new FormatoExportError('El export trae una lista con elementos de distinto tipo')
  }
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    // Formato ExportationExecute: { headers: [...], rows: [[...]] }
    if (Array.isArray(obj.rows) && Array.isArray(obj.headers)) {
      const nombres = (obj.headers as unknown[]).filter(h => h !== null).map((h, i) => nombreHeader(h, i))
      return (obj.rows as unknown[][])
        .filter(Array.isArray)
        .map(f => Object.fromEntries(nombres.map((n, i) => [n, f[i] ?? null])))
    }
    // Envoltorio con una sola lista adentro: { "Ventas": [ ... ] }
    for (const valor of Object.values(obj)) {
      if (Array.isArray(valor) && valor.some(v => v && typeof v === 'object')) return aFilas(valor)
    }
    return [obj]
  }
  return []
}

/** CSV simple (lo que ICG exporta como type 1): separador ; o , y comillas dobles. */
export function parsearCsv(texto: string): ItemCrudo[] {
  const limpio = texto.replace(/^﻿/, '')
  const primeraLinea = limpio.split(/\r?\n/, 1)[0] ?? ''
  const separador = (primeraLinea.match(/;/g)?.length ?? 0) >= (primeraLinea.match(/,/g)?.length ?? 0) ? ';' : ','
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let comillas = false
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i]
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') comillas = false
      else campo += c
    } else if (c === '"') comillas = true
    else if (c === separador) {
      fila.push(campo)
      campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++
      fila.push(campo)
      if (fila.some(v => v !== '')) filas.push(fila)
      fila = []
      campo = ''
    } else campo += c
  }
  fila.push(campo)
  if (fila.some(v => v !== '')) filas.push(fila)
  if (filas.length < 2) return []
  const [cabecera, ...datos] = filas
  return datos.map(f => Object.fromEntries(cabecera.map((n, i) => [n.trim() || `Columna ${i + 1}`, f[i] ?? null])))
}

export interface ResultadoDecodificacion {
  filas: ItemCrudo[]
  documentos: number
  formato: 'json' | 'csv' | 'ninguno'
}

/** Decodifica y une todos los documentos útiles del launch. */
export function decodificarDocumentos(documentos: DocumentoExportado[]): ResultadoDecodificacion {
  const json = documentos.filter(d => d.type === TIPO_JSON)
  const csv = documentos.filter(d => d.type === TIPO_CSV)
  const usados = json.length > 0 ? json : csv
  if (usados.length === 0) return { filas: [], documentos: documentos.length, formato: 'ninguno' }

  const filas: ItemCrudo[] = []
  for (const doc of usados) {
    const texto = Buffer.from(doc.data, 'base64').toString('utf8')
    filas.push(...(json.length > 0 ? aFilas(parsearJsonExport(texto)) : parsearCsv(texto)))
  }
  return { filas, documentos: documentos.length, formato: json.length > 0 ? 'json' : 'csv' }
}
