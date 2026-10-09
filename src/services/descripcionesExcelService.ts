import ExcelJS from 'exceljs'
import { createHash } from 'crypto'
import { query, getConnection } from '../config/database'
import { cargarWorkbook } from './importacionBancaria/xlsxCompat'

/**
 * ============================================================
 *  DESCRIPCIONES — EXPORTAR / IMPORTAR EXCEL
 * ============================================================
 *
 * El cliente exporta el catálogo completo de descripciones, lo edita en Excel
 * (nombre, tipo, categoría, subcategoría, activo) y lo vuelve a subir.
 *
 * La importación SINCRONIZA el catálogo con el archivo:
 *   - fila con ID existente → se actualiza si cambió algo
 *   - fila sin ID           → alta
 *   - ID que está en el sistema pero no en el archivo → baja (soft delete)
 *
 * Igual que la importación bancaria, va en dos pasos: preview (no escribe) y
 * confirmar (vuelve a parsear el mismo archivo y aplica en una transacción).
 * La `firma` es un hash de las operaciones planificadas: si entre el preview y
 * la confirmación cambió el catálogo (otro usuario editó algo), la firma no
 * coincide y se pide revisar de nuevo en vez de aplicar algo que nadie vio.
 *
 * Si hay al menos un error no se aplica nada: con sincronización total, aplicar
 * "lo que se pueda" podría dar de baja filas que solo tenían un error de tipeo.
 */

export const HOJA_DESCRIPCIONES = 'Descripciones'
const HOJA_CATEGORIAS = 'Categorías'
const HOJA_LISTAS = 'Listas'
const HOJA_INSTRUCCIONES = 'Instrucciones'

/** Filas vacías extra con listas desplegables, para que puedan agregar altas. */
const FILAS_EXTRA_VALIDACION = 500
const MAX_FILAS = 5000

export type Tipo = 'ingreso' | 'egreso'

const COLUMNAS = [
  { key: 'id', header: 'ID', width: 10 },
  { key: 'nombre', header: 'Nombre', width: 44 },
  { key: 'tipo', header: 'Tipo', width: 12 },
  { key: 'categoria', header: 'Categoría', width: 32 },
  { key: 'subcategoria', header: 'Subcategoría', width: 32 },
  { key: 'activo', header: 'Activo', width: 10 },
] as const

type ClaveColumna = (typeof COLUMNAS)[number]['key']

const COLUMNAS_REQUERIDAS: ClaveColumna[] = ['id', 'nombre', 'tipo', 'categoria', 'subcategoria']

/** Encabezados aceptados (normalizados) para cada columna. */
const ALIAS_COLUMNAS: Record<ClaveColumna, string[]> = {
  id: ['id'],
  nombre: ['nombre', 'descripcion'],
  tipo: ['tipo', 'tipo de movimiento'],
  categoria: ['categoria', 'categoria sugerida'],
  subcategoria: ['subcategoria', 'subcategoria sugerida'],
  activo: ['activo', 'activa', 'estado'],
}

export const INSTRUCCIONES = [
  'Editá nombre, tipo, categoría, subcategoría y activo directamente en la hoja "Descripciones".',
  'Para agregar una descripción nueva, agregá una fila y dejá la columna ID vacía.',
  'Para eliminar una descripción, borrá la fila completa: al importar se da de baja.',
  'No modifiques la columna ID: es la que vincula cada fila con el sistema.',
  'La categoría y la subcategoría tienen que existir (ver hoja "Categorías") y la subcategoría tiene que pertenecer a esa categoría.',
  'Antes de aplicar, el sistema muestra una vista previa con altas, cambios, bajas y errores. Si hay errores no se aplica nada.',
]

// ─────────────────────────────────────────────────────────────
//  Tipos
// ─────────────────────────────────────────────────────────────

interface DescripcionDB {
  id: number
  nombre: string
  tipo: Tipo | null
  categoria_id: number | null
  subcategoria_id: number | null
  activo: number | null
}

interface CategoriaDB {
  id: number
  nombre: string
  tipo: Tipo | null
}

interface SubcategoriaDB {
  id: number
  nombre: string
  categoria_id: number
}

export interface Catalogos {
  descripciones: DescripcionDB[]
  categorias: CategoriaDB[]
  subcategorias: SubcategoriaDB[]
}

export interface ValoresDescripcion {
  nombre: string
  tipo: Tipo | null
  categoria_id: number | null
  subcategoria_id: number | null
  activo: 0 | 1
}

export interface Operaciones {
  insertar: ValoresDescripcion[]
  actualizar: (ValoresDescripcion & { id: number })[]
  eliminar: number[]
}

export interface MensajeFila {
  fila: number | null
  mensaje: string
}

export interface FilaAlta {
  fila: number
  nombre: string
  tipo: string
  categoria: string
  subcategoria: string
  activo: boolean
}

export interface CambioCampo {
  campo: string
  antes: string
  despues: string
}

export interface FilaModificacion {
  fila: number
  id: number
  nombre: string
  cambios: CambioCampo[]
}

export interface FilaBaja {
  id: number
  nombre: string
  tipo: string
  categoria: string
  subcategoria: string
}

export interface PreviewDescripciones {
  archivo_hash: string
  firma: string
  resumen: {
    filas: number
    altas: number
    modificaciones: number
    bajas: number
    sin_cambios: number
    errores: number
    advertencias: number
  }
  altas: FilaAlta[]
  modificaciones: FilaModificacion[]
  bajas: FilaBaja[]
  errores: MensajeFila[]
  advertencias: MensajeFila[]
}

/** API de exceljs no tipada en index.d.ts (existe en lib/doc/data-validations.js). */
interface DataValidationsModel {
  add(address: string, validation: ExcelJS.DataValidation): void
}

/** Error del archivo en sí (no de una fila): se responde 400 con el mensaje. */
export class ErrorArchivoDescripciones extends Error {}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

/** Para comparar nombres: sin tildes, sin mayúsculas, espacios colapsados. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Para guardar: espacios colapsados y recortados, respetando mayúsculas y tildes. */
export function limpiar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim()
}

function textoCelda(cell: ExcelJS.Cell | undefined): string {
  if (!cell || cell.value === null || cell.value === undefined) return ''
  try {
    return limpiar(cell.text ?? '')
  } catch {
    return limpiar(String(cell.value))
  }
}

const TIPO_LABEL: Record<Tipo, string> = { ingreso: 'Ingreso', egreso: 'Egreso' }

function tipoLabel(tipo: Tipo | null): string {
  return tipo ? TIPO_LABEL[tipo] : ''
}

function parsearTipo(texto: string): Tipo | null | 'invalido' {
  const t = normalizar(texto)
  if (!t) return null
  if (t === 'ingreso' || t === 'ingresos') return 'ingreso'
  if (t === 'egreso' || t === 'egresos') return 'egreso'
  return 'invalido'
}

function parsearActivo(texto: string): 0 | 1 | null | 'invalido' {
  const t = normalizar(texto)
  if (!t) return null
  if (['si', 's', '1', 'true', 'verdadero', 'x', 'activo', 'activa'].includes(t)) return 1
  if (['no', 'n', '0', 'false', 'falso', 'inactivo', 'inactiva'].includes(t)) return 0
  return 'invalido'
}

function estiloCabecera(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1)
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002868' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  headerRow.height = 22
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

export async function cargarCatalogos(): Promise<Catalogos> {
  const [descripciones, categorias, subcategorias]: any[] = await Promise.all([
    query(
      `SELECT id, nombre, tipo, categoria_id, subcategoria_id, activo
       FROM descripciones
       WHERE deleted_at IS NULL
       ORDER BY nombre ASC, id ASC`,
      [],
    ),
    query('SELECT id, nombre, tipo FROM categorias WHERE deleted_at IS NULL ORDER BY nombre ASC', []),
    query(
      `SELECT s.id, s.nombre, s.categoria_id
       FROM subcategorias s
       INNER JOIN categorias c ON c.id = s.categoria_id AND c.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
       ORDER BY s.nombre ASC`,
      [],
    ),
  ])
  return {
    descripciones: (descripciones as any[]).map(d => ({
      id: Number(d.id),
      nombre: String(d.nombre ?? ''),
      tipo: d.tipo === 'ingreso' || d.tipo === 'egreso' ? d.tipo : null,
      categoria_id: d.categoria_id === null ? null : Number(d.categoria_id),
      subcategoria_id: d.subcategoria_id === null ? null : Number(d.subcategoria_id),
      activo: d.activo === null ? null : Number(d.activo),
    })),
    categorias: (categorias as any[]).map(c => ({
      id: Number(c.id),
      nombre: String(c.nombre ?? ''),
      tipo: c.tipo === 'ingreso' || c.tipo === 'egreso' ? c.tipo : null,
    })),
    subcategorias: (subcategorias as any[]).map(s => ({
      id: Number(s.id),
      nombre: String(s.nombre ?? ''),
      categoria_id: Number(s.categoria_id),
    })),
  }
}

/**
 * Valores "efectivos" de una descripción existente: si apunta a una categoría o
 * subcategoría eliminada (o a una subcategoría de otra categoría), se considera
 * vacía. Es lo mismo que ve el usuario en el Excel, así no aparecen cambios
 * fantasma al reimportar el archivo sin tocarlo.
 */
function valoresEfectivos(
  d: DescripcionDB,
  categoriasPorId: Map<number, CategoriaDB>,
  subcategoriasPorId: Map<number, SubcategoriaDB>,
): ValoresDescripcion {
  const categoria = d.categoria_id !== null ? categoriasPorId.get(d.categoria_id) : undefined
  const sub = d.subcategoria_id !== null ? subcategoriasPorId.get(d.subcategoria_id) : undefined
  return {
    nombre: limpiar(d.nombre),
    tipo: d.tipo,
    categoria_id: categoria ? categoria.id : null,
    subcategoria_id: categoria && sub && sub.categoria_id === categoria.id ? sub.id : null,
    activo: d.activo === 0 ? 0 : 1,
  }
}

// ─────────────────────────────────────────────────────────────
//  Exportar
// ─────────────────────────────────────────────────────────────

export async function generarExcelDescripciones(): Promise<ExcelJS.Workbook> {
  return construirWorkbook(await cargarCatalogos())
}

/** Separado de la carga para poder probarlo sin base de datos. */
export function construirWorkbook({ descripciones, categorias, subcategorias }: Catalogos): ExcelJS.Workbook {
  const categoriasPorId = new Map(categorias.map(c => [c.id, c]))
  const subcategoriasPorId = new Map(subcategorias.map(s => [s.id, s]))

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Heroica'
  workbook.created = new Date()

  // ── Hoja principal ─────────────────────────────────────────
  const sheet = workbook.addWorksheet(HOJA_DESCRIPCIONES)
  sheet.columns = COLUMNAS.map(c => ({ header: c.header, key: c.key, width: c.width }))

  for (const d of descripciones) {
    const v = valoresEfectivos(d, categoriasPorId, subcategoriasPorId)
    sheet.addRow({
      id: d.id,
      nombre: d.nombre,
      tipo: tipoLabel(v.tipo),
      categoria: v.categoria_id !== null ? categoriasPorId.get(v.categoria_id)!.nombre : '',
      subcategoria: v.subcategoria_id !== null ? subcategoriasPorId.get(v.subcategoria_id)!.nombre : '',
      activo: v.activo ? 'Sí' : 'No',
    })
  }

  estiloCabecera(sheet)
  sheet.autoFilter = { from: 'A1', to: `F${Math.max(descripciones.length + 1, 1)}` }
  sheet.getCell('A1').note = 'No modificar. Dejar vacío para agregar una descripción nueva.'

  // ── Hoja de listas (oculta) para los desplegables ──────────
  const listas = workbook.addWorksheet(HOJA_LISTAS, { state: 'hidden' })
  const nombresCategorias = [...new Set(categorias.map(c => c.nombre))]
  const nombresSubcategorias = [...new Set(subcategorias.map(s => s.nombre))].sort((a, b) => a.localeCompare(b, 'es'))
  listas.getCell('A1').value = 'Categorías'
  listas.getCell('B1').value = 'Subcategorías'
  nombresCategorias.forEach((n, i) => (listas.getCell(i + 2, 1).value = n))
  nombresSubcategorias.forEach((n, i) => (listas.getCell(i + 2, 2).value = n))

  const ultimaFila = descripciones.length + 1 + FILAS_EXTRA_VALIDACION
  const validacionLista = (formula: string, titulo: string, mensaje: string): ExcelJS.DataValidation => ({
    type: 'list',
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: titulo,
    error: mensaje,
  })

  const vTipo = validacionLista('"Ingreso,Egreso"', 'Tipo inválido', 'Elegí Ingreso o Egreso.')
  const vActivo = validacionLista('"Sí,No"', 'Valor inválido', 'Elegí Sí o No.')
  const vCategoria =
    nombresCategorias.length > 0
      ? validacionLista(
          `${HOJA_LISTAS}!$A$2:$A$${nombresCategorias.length + 1}`,
          'Categoría inexistente',
          'Elegí una categoría de la lista (ver hoja Categorías).',
        )
      : null
  const vSubcategoria =
    nombresSubcategorias.length > 0
      ? validacionLista(
          `${HOJA_LISTAS}!$B$2:$B$${nombresSubcategorias.length + 1}`,
          'Subcategoría inexistente',
          'Elegí una subcategoría de la lista (ver hoja Categorías).',
        )
      : null

  // Se agregan por rango y no celda por celda: el optimizador de exceljs 4.4 ordena
  // las direcciones como texto (C10 < C2) y genera rangos superpuestos, que Excel
  // marca como contenido dañado al abrir el archivo.
  const dataValidations = (sheet as unknown as { dataValidations: DataValidationsModel }).dataValidations
  dataValidations.add(`C2:C${ultimaFila}`, vTipo)
  dataValidations.add(`F2:F${ultimaFila}`, vActivo)
  if (vCategoria) dataValidations.add(`D2:D${ultimaFila}`, vCategoria)
  if (vSubcategoria) dataValidations.add(`E2:E${ultimaFila}`, vSubcategoria)

  for (let r = 2; r <= ultimaFila; r++) {
    // La columna ID va en gris para que se note que no se edita.
    const idCell = sheet.getCell(r, 1)
    idCell.font = { color: { argb: 'FF8A8F9C' } }
    idCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
  }

  // ── Hoja de referencia: categorías y sus subcategorías ─────
  const ref = workbook.addWorksheet(HOJA_CATEGORIAS)
  ref.columns = [
    { header: 'Categoría', key: 'categoria', width: 32 },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Subcategoría', key: 'subcategoria', width: 32 },
  ]
  for (const c of categorias) {
    const subs = subcategorias.filter(s => s.categoria_id === c.id)
    const tipo = c.tipo ? TIPO_LABEL[c.tipo] : 'Ambos'
    if (subs.length === 0) ref.addRow({ categoria: c.nombre, tipo, subcategoria: '' })
    for (const s of subs) ref.addRow({ categoria: c.nombre, tipo, subcategoria: s.nombre })
  }
  estiloCabecera(ref)

  // ── Instrucciones ──────────────────────────────────────────
  const inst = workbook.addWorksheet(HOJA_INSTRUCCIONES)
  inst.getColumn(1).width = 110
  inst.getCell('A1').value = 'Cómo editar este archivo'
  inst.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF002868' } }
  INSTRUCCIONES.forEach((linea, i) => {
    const cell = inst.getCell(i + 3, 1)
    cell.value = `${i + 1}. ${linea}`
    cell.alignment = { wrapText: true, vertical: 'top' }
  })

  return workbook
}

// ─────────────────────────────────────────────────────────────
//  Importar: planificar (no escribe)
// ─────────────────────────────────────────────────────────────

export function buscarHoja(workbook: ExcelJS.Workbook): ExcelJS.Worksheet {
  const porNombre = workbook.worksheets.find(ws => normalizar(ws.name) === normalizar(HOJA_DESCRIPCIONES))
  const hoja = porNombre ?? workbook.worksheets.find(ws => ws.state === 'visible') ?? workbook.worksheets[0]
  if (!hoja) throw new ErrorArchivoDescripciones('El archivo no tiene hojas.')
  return hoja
}

export function mapearColumnas(hoja: ExcelJS.Worksheet): Partial<Record<ClaveColumna, number>> {
  const mapa: Partial<Record<ClaveColumna, number>> = {}
  const header = hoja.getRow(1)
  header.eachCell({ includeEmpty: false }, (cell, col) => {
    const texto = normalizar(textoCelda(cell))
    for (const clave of Object.keys(ALIAS_COLUMNAS) as ClaveColumna[]) {
      if (mapa[clave] === undefined && ALIAS_COLUMNAS[clave].includes(texto)) mapa[clave] = col
    }
  })
  const faltantes = COLUMNAS_REQUERIDAS.filter(c => mapa[c] === undefined)
  if (faltantes.length > 0) {
    const nombres = faltantes.map(c => `"${COLUMNAS.find(x => x.key === c)!.header}"`).join(', ')
    throw new ErrorArchivoDescripciones(
      `Faltan columnas en la hoja "${hoja.name}": ${nombres}. Usá el archivo exportado desde el sistema.`,
    )
  }
  return mapa
}

export async function planificarImportacion(
  buffer: Buffer,
): Promise<{ preview: PreviewDescripciones; operaciones: Operaciones }> {
  let workbook: ExcelJS.Workbook
  try {
    workbook = (await cargarWorkbook(buffer)).workbook
  } catch {
    throw new ErrorArchivoDescripciones(
      'No se pudo leer el archivo. Verificá que sea un .xlsx válido y que no esté dañado.',
    )
  }

  const hoja = buscarHoja(workbook)
  const columnas = mapearColumnas(hoja)
  return planificarConCatalogos(hoja, columnas, buffer, await cargarCatalogos())
}

/** Separado de la carga para poder probarlo sin base de datos. */
export function planificarConCatalogos(
  hoja: ExcelJS.Worksheet,
  columnas: Partial<Record<ClaveColumna, number>>,
  buffer: Buffer,
  { descripciones, categorias, subcategorias }: Catalogos,
): { preview: PreviewDescripciones; operaciones: Operaciones } {
  const descripcionesPorId = new Map(descripciones.map(d => [d.id, d]))
  const categoriasPorId = new Map(categorias.map(c => [c.id, c]))
  const subcategoriasPorId = new Map(subcategorias.map(s => [s.id, s]))

  const errores: MensajeFila[] = []
  const advertencias: MensajeFila[] = []
  const altas: FilaAlta[] = []
  const modificaciones: FilaModificacion[] = []
  const operaciones: Operaciones = { insertar: [], actualizar: [], eliminar: [] }

  const filaPorId = new Map<number, number>()
  const filasPorNombre = new Map<string, number[]>()
  let filasConDatos = 0
  let sinCambios = 0

  const leer = (row: ExcelJS.Row, clave: ClaveColumna) => {
    const col = columnas[clave]
    return col === undefined ? '' : textoCelda(row.getCell(col))
  }

  const nombreCategoria = (id: number | null) => (id !== null ? (categoriasPorId.get(id)?.nombre ?? '') : '')
  const nombreSubcategoria = (id: number | null) => (id !== null ? (subcategoriasPorId.get(id)?.nombre ?? '') : '')

  for (let r = 2; r <= hoja.rowCount; r++) {
    const row = hoja.getRow(r)
    const crudo = {
      id: leer(row, 'id'),
      nombre: leer(row, 'nombre'),
      tipo: leer(row, 'tipo'),
      categoria: leer(row, 'categoria'),
      subcategoria: leer(row, 'subcategoria'),
      activo: leer(row, 'activo'),
    }
    if (Object.values(crudo).every(v => v === '')) continue

    filasConDatos++
    if (filasConDatos > MAX_FILAS) {
      throw new ErrorArchivoDescripciones(`El archivo tiene más de ${MAX_FILAS} filas con datos.`)
    }

    const erroresFila: string[] = []

    // ── ID ──
    let existente: DescripcionDB | undefined
    if (crudo.id) {
      const id = Number(crudo.id)
      if (!Number.isInteger(id) || id <= 0) {
        erroresFila.push(`ID "${crudo.id}" inválido. Para una descripción nueva dejá el ID vacío.`)
      } else if (filaPorId.has(id)) {
        erroresFila.push(`El ID ${id} está repetido (también en la fila ${filaPorId.get(id)}).`)
      } else {
        filaPorId.set(id, r)
        existente = descripcionesPorId.get(id)
        if (!existente) {
          erroresFila.push(
            `El ID ${id} no existe en el sistema (¿se eliminó o se modificó el ID?). Para una descripción nueva dejá el ID vacío.`,
          )
        }
      }
    }
    const actual = existente ? valoresEfectivos(existente, categoriasPorId, subcategoriasPorId) : undefined

    // ── Nombre ──
    const nombre = crudo.nombre
    if (!nombre) erroresFila.push('Falta el nombre.')
    else if (nombre.length > 255) erroresFila.push('El nombre supera los 255 caracteres.')

    // ── Tipo ──
    let tipo: Tipo | null = null
    const tipoParseado = parsearTipo(crudo.tipo)
    if (tipoParseado === 'invalido') {
      erroresFila.push(`Tipo "${crudo.tipo}" inválido. Usá Ingreso o Egreso.`)
    } else if (tipoParseado === null) {
      // Las descripciones viejas pueden no tener tipo: se permite dejarlo vacío
      // solo si ya estaba vacío. Las nuevas lo requieren (igual que el formulario).
      if (actual && actual.tipo === null) tipo = null
      else erroresFila.push('Falta el tipo (Ingreso o Egreso).')
    } else {
      tipo = tipoParseado
    }

    // ── Activo ──
    let activo: 0 | 1 = actual ? actual.activo : 1
    const activoParseado = parsearActivo(crudo.activo)
    if (activoParseado === 'invalido') erroresFila.push(`Activo "${crudo.activo}" inválido. Usá Sí o No.`)
    else if (activoParseado !== null) activo = activoParseado

    // ── Categoría / subcategoría ──
    let categoriaId: number | null = null
    let subcategoriaId: number | null = null
    if (!crudo.categoria) {
      if (crudo.subcategoria) erroresFila.push('Hay subcategoría pero falta la categoría.')
    } else {
      const coinciden = categorias.filter(c => normalizar(c.nombre) === normalizar(crudo.categoria))
      const compatibles = tipo ? coinciden.filter(c => c.tipo === null || c.tipo === tipo) : coinciden
      if (coinciden.length === 0) {
        erroresFila.push(`La categoría "${crudo.categoria}" no existe. Revisá la hoja Categorías.`)
      } else if (compatibles.length === 0) {
        erroresFila.push(`La categoría "${crudo.categoria}" es de ${coinciden[0].tipo} y la descripción es de ${tipo}.`)
      } else if (compatibles.length > 1) {
        erroresFila.push(
          `Hay más de una categoría llamada "${crudo.categoria}". Renombrá una en Configuración > Categorías.`,
        )
      } else {
        const categoria = compatibles[0]
        categoriaId = categoria.id
        if (crudo.subcategoria) {
          const subs = subcategorias.filter(
            s => s.categoria_id === categoria.id && normalizar(s.nombre) === normalizar(crudo.subcategoria),
          )
          if (subs.length === 0) {
            erroresFila.push(`La subcategoría "${crudo.subcategoria}" no existe dentro de "${categoria.nombre}".`)
          } else if (subs.length > 1) {
            erroresFila.push(
              `Hay más de una subcategoría "${crudo.subcategoria}" en "${categoria.nombre}". Renombrá una en Configuración > Subcategorías.`,
            )
          } else {
            subcategoriaId = subs[0].id
          }
        }
      }
    }

    if (erroresFila.length > 0) {
      for (const mensaje of erroresFila) errores.push({ fila: r, mensaje })
      continue
    }

    const claveNombre = `${normalizar(nombre)}|${tipo ?? ''}`
    filasPorNombre.set(claveNombre, [...(filasPorNombre.get(claveNombre) ?? []), r])

    const nuevo: ValoresDescripcion = {
      nombre,
      tipo,
      categoria_id: categoriaId,
      subcategoria_id: subcategoriaId,
      activo,
    }

    if (existente && actual) {
      const cambios: CambioCampo[] = []
      if (actual.nombre !== nuevo.nombre) cambios.push({ campo: 'Nombre', antes: actual.nombre, despues: nuevo.nombre })
      if (actual.tipo !== nuevo.tipo)
        cambios.push({ campo: 'Tipo', antes: tipoLabel(actual.tipo), despues: tipoLabel(nuevo.tipo) })
      if (actual.categoria_id !== nuevo.categoria_id)
        cambios.push({
          campo: 'Categoría',
          antes: nombreCategoria(actual.categoria_id),
          despues: nombreCategoria(nuevo.categoria_id),
        })
      if (actual.subcategoria_id !== nuevo.subcategoria_id)
        cambios.push({
          campo: 'Subcategoría',
          antes: nombreSubcategoria(actual.subcategoria_id),
          despues: nombreSubcategoria(nuevo.subcategoria_id),
        })
      if (actual.activo !== nuevo.activo)
        cambios.push({ campo: 'Activo', antes: actual.activo ? 'Sí' : 'No', despues: nuevo.activo ? 'Sí' : 'No' })

      if (cambios.length === 0) {
        sinCambios++
      } else {
        modificaciones.push({ fila: r, id: existente.id, nombre: nuevo.nombre, cambios })
        operaciones.actualizar.push({ id: existente.id, ...nuevo })
      }
    } else {
      altas.push({
        fila: r,
        nombre: nuevo.nombre,
        tipo: tipoLabel(nuevo.tipo),
        categoria: nombreCategoria(nuevo.categoria_id),
        subcategoria: nombreSubcategoria(nuevo.subcategoria_id),
        activo: nuevo.activo === 1,
      })
      operaciones.insertar.push(nuevo)
    }
  }

  if (filasConDatos === 0) {
    throw new ErrorArchivoDescripciones(
      'El archivo no tiene descripciones. Si de verdad querés eliminarlas todas, hacelo desde el sistema.',
    )
  }

  for (const [, filas] of filasPorNombre) {
    if (filas.length > 1) {
      advertencias.push({
        fila: filas[0],
        mensaje: `Nombre repetido con el mismo tipo en las filas ${filas.join(', ')}.`,
      })
    }
  }

  // ── Bajas: lo que está en el sistema y no vino en el archivo ──
  const bajas: FilaBaja[] = descripciones
    .filter(d => !filaPorId.has(d.id))
    .map(d => {
      const v = valoresEfectivos(d, categoriasPorId, subcategoriasPorId)
      return {
        id: d.id,
        nombre: d.nombre,
        tipo: tipoLabel(v.tipo),
        categoria: nombreCategoria(v.categoria_id),
        subcategoria: nombreSubcategoria(v.subcategoria_id),
      }
    })
  operaciones.eliminar = bajas.map(b => b.id)

  const preview: PreviewDescripciones = {
    archivo_hash: sha256(buffer),
    firma: sha256(Buffer.from(JSON.stringify(operaciones))),
    resumen: {
      filas: filasConDatos,
      altas: altas.length,
      modificaciones: modificaciones.length,
      bajas: bajas.length,
      sin_cambios: sinCambios,
      errores: errores.length,
      advertencias: advertencias.length,
    },
    altas,
    modificaciones,
    bajas,
    errores,
    advertencias,
  }

  return { preview, operaciones }
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

// ─────────────────────────────────────────────────────────────
//  Importar: aplicar
// ─────────────────────────────────────────────────────────────

export async function aplicarOperaciones(operaciones: Operaciones): Promise<void> {
  const connection = await getConnection()
  try {
    await connection.beginTransaction()

    if (operaciones.insertar.length > 0) {
      await connection.query(
        'INSERT INTO descripciones (nombre, tipo, categoria_id, subcategoria_id, activo) VALUES ?',
        [operaciones.insertar.map(d => [d.nombre, d.tipo, d.categoria_id, d.subcategoria_id, d.activo])],
      )
    }

    for (const d of operaciones.actualizar) {
      await connection.query(
        `UPDATE descripciones
         SET nombre = ?, tipo = ?, categoria_id = ?, subcategoria_id = ?, activo = ?
         WHERE id = ? AND deleted_at IS NULL`,
        [d.nombre, d.tipo, d.categoria_id, d.subcategoria_id, d.activo, d.id],
      )
    }

    if (operaciones.eliminar.length > 0) {
      await connection.query('UPDATE descripciones SET deleted_at = NOW() WHERE id IN (?) AND deleted_at IS NULL', [
        operaciones.eliminar,
      ])
    }

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
