import crypto from 'crypto'
import type { Row, Worksheet } from 'exceljs'
import type { FilaNormalizada } from './types'

/**
 * Utilidades compartidas por todos los adapters de bancos.
 * Todo lo que sea "leer una celda de Excel sin que explote" vive acá.
 */

/** Convierte cualquier valor de celda de ExcelJS a texto plano y limpio. */
export function celdaTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'string') return valor.trim()
  if (typeof valor === 'number') return String(valor)
  if (typeof valor === 'boolean') return valor ? 'true' : 'false'
  if (valor instanceof Date) return valor.toISOString()

  const obj = valor as Record<string, unknown>
  // Celda con fórmula: { formula, result }
  if ('result' in obj) return celdaTexto(obj.result)
  // Texto enriquecido: { richText: [{ text }] }
  if ('richText' in obj && Array.isArray(obj.richText)) {
    return obj.richText
      .map((t: { text?: string }) => t.text ?? '')
      .join('')
      .trim()
  }
  // Hipervínculo: { text, hyperlink }
  if ('text' in obj) return celdaTexto(obj.text)

  return String(valor).trim()
}

/**
 * Parsea un monto que puede venir como número o como texto en formato argentino
 * ("1.234.567,89"), inglés ("1,234,567.89") o con signo/paréntesis para negativos.
 * Devuelve 0 si la celda está vacía.
 */
export function parseMonto(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return 0
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0

  let texto = celdaTexto(valor)
  if (!texto) return 0

  // (1.234,56) → -1234.56
  let negativo = false
  if (/^\(.*\)$/.test(texto)) {
    negativo = true
    texto = texto.slice(1, -1)
  }
  if (texto.startsWith('-')) {
    negativo = true
    texto = texto.slice(1)
  }

  texto = texto.replace(/[^\d.,]/g, '')
  if (!texto) return 0

  const ultimaComa = texto.lastIndexOf(',')
  const ultimoPunto = texto.lastIndexOf('.')

  if (ultimaComa > ultimoPunto) {
    // Formato AR: el separador decimal es la coma
    texto = texto.replace(/\./g, '').replace(',', '.')
  } else if (ultimoPunto > ultimaComa) {
    // Formato EN: el separador decimal es el punto
    texto = texto.replace(/,/g, '')
  } else {
    texto = texto.replace(/[.,]/g, '')
  }

  const n = Number(texto)
  if (!Number.isFinite(n)) return 0
  return negativo ? -n : n
}

/**
 * Parsea una fecha de celda a 'YYYY-MM-DD'. Acepta Date de ExcelJS, serial de
 * Excel, y strings 'DD/MM/YYYY', 'DD-MM-YYYY' o 'YYYY-MM-DD'.
 * Devuelve null si no logra interpretarla.
 *
 * OJO CON LA ZONA HORARIA: en Excel una fecha es "wall-clock", no tiene zona.
 * ExcelJS la materializa como un Date a medianoche UTC. Si se leyera con getters
 * locales, en Argentina (UTC−3) el 27/07 a las 00:00 UTC se convierte en el 26/07
 * a las 21:00 y toda la importación queda corrida un día. Por eso las fechas que
 * vienen de una celda se leen SIEMPRE en UTC.
 */
export function parseFecha(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null

  // Date producido por ExcelJS a partir de un serial → medianoche UTC.
  if (valor instanceof Date) return aISO(valor, true)

  if (typeof valor === 'number') {
    // Serial de Excel: días desde 1899-12-30.
    const ms = Math.round((valor - 25569) * 86400 * 1000)
    return aISO(new Date(ms), true)
  }

  const texto = celdaTexto(valor)
  if (!texto) return null

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const ar = texto.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (ar) {
    const dia = ar[1].padStart(2, '0')
    const mes = ar[2].padStart(2, '0')
    let anio = ar[3]
    if (anio.length === 2) anio = `20${anio}`
    return `${anio}-${mes}-${dia}`
  }

  // Último recurso: texto en un formato no contemplado. Si trae zona explícita se
  // interpreta en UTC; si no, JS ya lo resolvió en hora local y hay que leerlo igual.
  const parsed = new Date(texto)
  if (Number.isNaN(parsed.getTime())) return null
  const traeZona = /(Z|[+-]\d{2}:?\d{2})$/.test(texto)
  return aISO(parsed, traeZona)
}

function aISO(fecha: Date, utc = false): string {
  const y = utc ? fecha.getUTCFullYear() : fecha.getFullYear()
  const m = String((utc ? fecha.getUTCMonth() : fecha.getMonth()) + 1).padStart(2, '0')
  const d = String(utc ? fecha.getUTCDate() : fecha.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Varios bancos exportan el concepto como "917403 - NAVE - VENTA CON TARJETA".
 * Separa el código (primer token numérico) de la descripción, sin romperse si el
 * texto tiene guiones adicionales.
 */
export function separarCodigoDescripcion(texto: string): { codigo: string; descripcion: string } {
  const limpio = (texto ?? '').trim()
  if (!limpio) return { codigo: '', descripcion: '' }

  const m = limpio.match(/^([0-9]+)\s*[-–]\s*(.*)$/)
  if (m) return { codigo: m[1], descripcion: m[2].trim() }

  return { codigo: limpio, descripcion: limpio }
}

/** Normaliza un encabezado para comparar sin depender de tildes, mayúsculas ni espacios. */
export function normalizarHeader(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Busca la fila de encabezados dentro de las primeras `maxFilas` y devuelve un
 * mapa header normalizado → número de columna. Los extractos suelen traer
 * metadatos arriba de la tabla, así que no se puede asumir que el header es la fila 1.
 */
export function ubicarHeaders(
  worksheet: Worksheet,
  headersRequeridos: string[],
  maxFilas = 25,
): { filaHeader: number; columnas: Record<string, number> } | null {
  const requeridos = headersRequeridos.map(normalizarHeader)

  for (let i = 1; i <= Math.min(maxFilas, worksheet.rowCount); i++) {
    const fila: Row = worksheet.getRow(i)
    const columnas: Record<string, number> = {}

    fila.eachCell({ includeEmpty: false }, (celda, colNumber) => {
      const clave = normalizarHeader(celdaTexto(celda.value))
      if (clave && !(clave in columnas)) columnas[clave] = colNumber
    })

    if (requeridos.every(h => h in columnas)) return { filaHeader: i, columnas }
  }

  return null
}

/** SHA-256 en hex. */
export function sha256(texto: string | Buffer): string {
  return crypto.createHash('sha256').update(texto).digest('hex')
}

/**
 * Calcula el hash de idempotencia de una fila.
 *
 * Si el banco provee un ID de operación, alcanza con (fecha + operación): es único
 * y estable entre reexportaciones. Si no lo provee (impuestos, echeqs en Galicia),
 * se cae al saldo corriente —que es único por fila dentro de una cuenta— más un
 * índice de ocurrencia como último desempate.
 *
 * NO incluye el nombre del archivo ni la fecha de importación a propósito: el mismo
 * movimiento tiene que producir el mismo hash cuando se resube el acumulado.
 */
export function calcularFilaHash(fila: FilaNormalizada, ocurrencia: number): string {
  if (fila.operacionId) {
    return sha256(`v1|${fila.fecha}|op:${fila.operacionId}|${fila.monto.toFixed(2)}`)
  }
  const saldo = fila.saldoBanco !== null ? fila.saldoBanco.toFixed(2) : ''
  return sha256(`v1|${fila.fecha}|cc:${fila.conceptoCodigo}|${fila.monto.toFixed(2)}|s:${saldo}|n:${ocurrencia}`)
}

/**
 * Asigna a cada fila su hash de idempotencia, resolviendo el índice de ocurrencia
 * para las filas sin ID de operación que serían idénticas entre sí.
 */
export function hashearFilas(filas: FilaNormalizada[]): string[] {
  const vistos = new Map<string, number>()
  return filas.map(fila => {
    const claveBase = `${fila.fecha}|${fila.conceptoCodigo}|${fila.monto.toFixed(2)}|${fila.saldoBanco ?? ''}`
    const ocurrencia = vistos.get(claveBase) ?? 0
    vistos.set(claveBase, ocurrencia + 1)
    return calcularFilaHash(fila, ocurrencia)
  })
}
