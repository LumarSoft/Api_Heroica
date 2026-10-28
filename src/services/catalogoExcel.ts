import ExcelJS from 'exceljs'
import { createHash } from 'crypto'

/**
 * Piezas comunes de los Excel de catálogos (descripciones, proveedores): lectura de celdas,
 * estilos, hoja de instrucciones y la columna "Unificar con ID", que fusiona un duplicado
 * con el registro que queda pasándole sus movimientos.
 */

export interface MensajeFila {
  fila: number | null
  mensaje: string
}

export interface CambioCampo {
  campo: string
  antes: string
  despues: string
}

export interface FilaUnificacion {
  fila: number
  id: number
  nombre: string
  destino_id: number
  destino_nombre: string
  movimientos: number
}

export interface Unificacion {
  origen: number
  destino: number
}

/** API de exceljs no tipada en index.d.ts (existe en lib/doc/data-validations.js). */
export interface DataValidationsModel {
  add(address: string, validation: ExcelJS.DataValidation): void
}

export const ENCABEZADO_UNIFICAR = 'Unificar con ID'
export const ALIAS_UNIFICAR = ['unificar con id', 'unificar con', 'unificar', 'fusionar con id', 'fusionar con']

/** Para comparar nombres: sin tildes, sin mayúsculas, espacios colapsados. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Para guardar: espacios colapsados y recortados, respetando mayúsculas y tildes. */
export function limpiar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim()
}

export function textoCelda(cell: ExcelJS.Cell | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined) return ''
  try {
    return limpiar(cell.text ?? '')
  } catch {
    return limpiar(String(cell.value))
  }
}

export function parsearActivo(texto: string): 0 | 1 | null | 'invalido' {
  const t = normalizar(texto)
  if (!t) return null
  if (['si', 's', '1', 'true', 'verdadero', 'x', 'activo', 'activa'].includes(t)) return 1
  if (['no', 'n', '0', 'false', 'falso', 'inactivo', 'inactiva'].includes(t)) return 0
  return 'invalido'
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export function estiloCabecera(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1)
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002868' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  headerRow.height = 22
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

/** Columna ID en gris (no se edita) y columna "Unificar con ID" en amarillo claro. */
export function pintarColumnasEspeciales(sheet: ExcelJS.Worksheet, ultimaFila: number, colUnificar: number) {
  for (let r = 2; r <= ultimaFila; r++) {
    const idCell = sheet.getCell(r, 1)
    idCell.font = { color: { argb: 'FF8A8F9C' } }
    idCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
    sheet.getCell(r, colUnificar).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } }
  }
}

export function agregarInstrucciones(workbook: ExcelJS.Workbook, lineas: string[]) {
  const inst = workbook.addWorksheet('Instrucciones')
  inst.getColumn(1).width = 110
  inst.getCell('A1').value = 'Cómo editar este archivo'
  inst.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF002868' } }
  lineas.forEach((linea, i) => {
    const cell = inst.getCell(i + 3, 1)
    cell.value = `${i + 1}. ${linea}`
    cell.alignment = { wrapText: true, vertical: 'top' }
  })
}

/** Cantidad de movimientos (no borrados) por valor de una columna FK de `movimientos`. */
export function contarPorId(filas: { id: unknown; n: unknown }[]): Map<number, number> {
  return new Map(filas.map(f => [Number(f.id), Number(f.n)]))
}

export interface FilaNombre {
  fila: number
  id: number | null
}

/** Advertencia de nombre repetido, con los IDs para que se pueda unificar */
export function avisoNombreRepetido(filas: FilaNombre[], detalle = ''): MensajeFila {
  const ids = filas.map(f => f.id).filter((id): id is number => id !== null)
  const listaIds = ids.length > 0 ? ` (IDs ${ids.join(', ')})` : ''
  const sugerencia =
    ids.length >= 2 ? ` Si es un duplicado, en las otras filas poné ${ids[0]} en "${ENCABEZADO_UNIFICAR}".` : ''
  return {
    fila: filas[0].fila,
    mensaje: `Nombre repetido${detalle} en las filas ${filas.map(f => f.fila).join(', ')}${listaIds}.${sugerencia}`,
  }
}

export interface PedidoUnificar {
  fila: number
  id: number
  destinoCrudo: string
}

/**
 * Valida las filas que piden unificarse con otro registro. El destino tiene que existir,
 * ser otro y quedar en el archivo (no puede eliminarse ni unificarse a su vez).
 * `incompatible` permite reglas propias del catálogo (por ejemplo, que coincida el tipo).
 */
export function resolverUnificaciones<T extends { id: number; nombre: string; movimientos: number }>(
  pedidos: PedidoUnificar[],
  existentesPorId: Map<number, T>,
  idsEnArchivo: Set<number>,
  incompatible?: (origen: T, destino: T) => string | null,
): { unificaciones: FilaUnificacion[]; operaciones: Unificacion[]; errores: MensajeFila[] } {
  const unificaciones: FilaUnificacion[] = []
  const operaciones: Unificacion[] = []
  const errores: MensajeFila[] = []
  const idsQueSeUnifican = new Set(pedidos.map(p => p.id))

  for (const p of pedidos) {
    const origen = existentesPorId.get(p.id)
    if (!origen) continue
    const destinoId = Number(p.destinoCrudo)
    const destino = Number.isInteger(destinoId) && destinoId > 0 ? existentesPorId.get(destinoId) : undefined

    let error: string | null = null
    if (!Number.isInteger(destinoId) || destinoId <= 0) error = `"${p.destinoCrudo}" no es un ID válido para unificar.`
    else if (destinoId === p.id) error = 'No se puede unificar consigo misma: poné el ID del registro que queda.'
    else if (!destino) error = `El ID ${destinoId} (con el que se unifica) no existe en el sistema.`
    else if (idsQueSeUnifican.has(destinoId))
      error = `El ID ${destinoId} también se está unificando: poné directamente el ID del registro que queda.`
    else if (!idsEnArchivo.has(destinoId))
      error = `El ID ${destinoId} (con el que se unifica) no está en el archivo: no lo borres si es el que queda.`
    else error = incompatible?.(origen, destino) ?? null

    if (error || !destino) {
      errores.push({ fila: p.fila, mensaje: error ?? 'No se pudo unificar.' })
      continue
    }
    unificaciones.push({
      fila: p.fila,
      id: origen.id,
      nombre: origen.nombre,
      destino_id: destino.id,
      destino_nombre: destino.nombre,
      movimientos: origen.movimientos,
    })
    operaciones.push({ origen: origen.id, destino: destino.id })
  }

  return { unificaciones, operaciones, errores }
}
