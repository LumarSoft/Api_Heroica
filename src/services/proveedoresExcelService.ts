import ExcelJS from 'exceljs'
import { query, getConnection } from '../config/database'
import { cargarWorkbook } from './importacionBancaria/xlsxCompat'
import { DatosProveedor, validarDatosProveedor } from '../utils/proveedoresHelpers'
import {
  ALIAS_UNIFICAR,
  CambioCampo,
  DataValidationsModel,
  ENCABEZADO_UNIFICAR,
  FilaNombre,
  FilaUnificacion,
  MensajeFila,
  PedidoUnificar,
  Unificacion,
  agregarInstrucciones,
  avisoNombreRepetido,
  contarPorId,
  estiloCabecera,
  normalizar,
  parsearActivo,
  pintarColumnasEspeciales,
  resolverUnificaciones,
  sha256,
  textoCelda,
} from './catalogoExcel'

/**
 * ============================================================
 *  PROVEEDORES — EXPORTAR / IMPORTAR EXCEL
 * ============================================================
 *
 * Mismo esquema que el Excel de descripciones: la importación sincroniza el catálogo.
 *   - fila con ID existente → se actualiza si cambió algo
 *   - fila sin ID           → alta
 *   - ID que no vino en el archivo → baja. Igual que desde la pantalla, el proveedor se
 *     borra y los movimientos que lo usaban quedan sin proveedor.
 *   - fila con "Unificar con ID" → sus movimientos pasan a ese proveedor y este se borra
 *
 * Si hay al menos un error no se aplica nada.
 */

const HOJA_PROVEEDORES = 'Proveedores'
const FILAS_EXTRA_VALIDACION = 500
const MAX_FILAS = 5000

const COLUMNAS = [
  { key: 'id', header: 'ID', width: 10 },
  { key: 'nombre', header: 'Nombre', width: 36 },
  { key: 'razon_social', header: 'Razón social', width: 36 },
  { key: 'cuit', header: 'CUIT', width: 16 },
  { key: 'cbu_alias', header: 'CBU / Alias', width: 28 },
  { key: 'telefono', header: 'Teléfono', width: 18 },
  { key: 'email', header: 'Email', width: 30 },
  { key: 'direccion', header: 'Dirección', width: 36 },
  { key: 'activo', header: 'Activo', width: 10 },
  { key: 'unificar', header: ENCABEZADO_UNIFICAR, width: 16 },
] as const

type ClaveColumna = (typeof COLUMNAS)[number]['key']

const COLUMNAS_REQUERIDAS: ClaveColumna[] = ['id', 'nombre']

const ALIAS_COLUMNAS: Record<ClaveColumna, string[]> = {
  id: ['id'],
  nombre: ['nombre', 'proveedor'],
  razon_social: ['razon social'],
  cuit: ['cuit', 'cuil', 'cuit/cuil'],
  cbu_alias: ['cbu / alias', 'cbu/alias', 'cbu', 'alias', 'cbu o alias'],
  telefono: ['telefono', 'tel', 'celular'],
  email: ['email', 'mail', 'correo', 'e-mail'],
  direccion: ['direccion', 'domicilio'],
  activo: ['activo', 'activa', 'estado'],
  unificar: ALIAS_UNIFICAR,
}

/** Columnas que se guardan como texto para que Excel no convierta CUIT o CBU en números. */
const COLUMNAS_TEXTO: ClaveColumna[] = ['cuit', 'cbu_alias', 'telefono']

const CAMPOS: { key: keyof DatosProveedor; label: string }[] = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'razon_social', label: 'Razón social' },
  { key: 'cuit', label: 'CUIT' },
  { key: 'cbu_alias', label: 'CBU / Alias' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'email', label: 'Email' },
  { key: 'direccion', label: 'Dirección' },
]

export const INSTRUCCIONES = [
  'Editá los datos directamente en la hoja "Proveedores". Solo el nombre es obligatorio.',
  'Para agregar un proveedor nuevo, agregá una fila y dejá la columna ID vacía.',
  'El CUIT se puede escribir con o sin guiones; tiene que tener 11 números.',
  'Para eliminar un proveedor, borrá la fila completa. Los movimientos que lo usaban quedan sin proveedor.',
  'Para unificar un proveedor repetido, no lo borres: en "Unificar con ID" poné el ID del que queda. Sus movimientos pasan a ese y el repetido se elimina.',
  'No modifiques la columna ID: es la que vincula cada fila con el sistema.',
  'Antes de aplicar, el sistema muestra una vista previa con altas, cambios, bajas y errores. Si hay errores no se aplica nada.',
]

// ─────────────────────────────────────────────────────────────
//  Tipos
// ─────────────────────────────────────────────────────────────

interface ProveedorDB extends DatosProveedor {
  id: number
  activo: 0 | 1
  movimientos: number
}

type ValoresProveedor = DatosProveedor & { activo: 0 | 1 }

export interface Operaciones {
  insertar: ValoresProveedor[]
  actualizar: (ValoresProveedor & { id: number })[]
  eliminar: number[]
  unificar: Unificacion[]
}

interface FilaAlta {
  fila: number
  nombre: string
  cuit: string
  activo: boolean
}

interface FilaModificacion {
  fila: number
  id: number
  nombre: string
  cambios: CambioCampo[]
}

interface FilaBaja {
  id: number
  nombre: string
  cuit: string
  movimientos: number
}

export interface PreviewProveedores {
  archivo_hash: string
  firma: string
  resumen: {
    filas: number
    altas: number
    modificaciones: number
    bajas: number
    unificaciones: number
    sin_cambios: number
    errores: number
    advertencias: number
  }
  altas: FilaAlta[]
  modificaciones: FilaModificacion[]
  bajas: FilaBaja[]
  unificaciones: FilaUnificacion[]
  errores: MensajeFila[]
  advertencias: MensajeFila[]
}

export class ErrorArchivoProveedores extends Error {}

/** Valor de un campo para la vista previa: el CUIT se muestra con guiones */
function mostrar(campo: keyof DatosProveedor, valor: string | null): string {
  if (!valor) return ''
  return campo === 'cuit' && /^\d{11}$/.test(valor)
    ? `${valor.slice(0, 2)}-${valor.slice(2, 10)}-${valor.slice(10)}`
    : valor
}

// ─────────────────────────────────────────────────────────────
//  Carga y exportación
// ─────────────────────────────────────────────────────────────

async function cargarProveedores(): Promise<ProveedorDB[]> {
  const [proveedores, usos]: any[] = await Promise.all([
    query(
      `SELECT id, nombre, razon_social, cuit, cbu_alias, telefono, email, direccion, activo
       FROM proveedores ORDER BY nombre ASC, id ASC`,
      [],
    ),
    query(
      `SELECT proveedor_id AS id, COUNT(*) AS n FROM movimientos
       WHERE proveedor_id IS NOT NULL AND deleted_at IS NULL
       GROUP BY proveedor_id`,
      [],
    ),
  ])
  const movimientosPorId = contarPorId(usos)
  const texto = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v).trim() || null)
  return (proveedores as any[]).map(p => ({
    id: Number(p.id),
    nombre: String(p.nombre ?? '').trim(),
    razon_social: texto(p.razon_social),
    cuit: texto(p.cuit),
    cbu_alias: texto(p.cbu_alias),
    telefono: texto(p.telefono),
    email: texto(p.email),
    direccion: texto(p.direccion),
    activo: p.activo === 0 ? 0 : 1,
    movimientos: movimientosPorId.get(Number(p.id)) ?? 0,
  }))
}

export async function generarExcelProveedores(): Promise<ExcelJS.Workbook> {
  const proveedores = await cargarProveedores()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Heroica'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(HOJA_PROVEEDORES)
  sheet.columns = COLUMNAS.map(c => ({ header: c.header, key: c.key, width: c.width }))
  for (const p of proveedores) {
    sheet.addRow({ ...p, activo: p.activo ? 'Sí' : 'No', unificar: '' })
  }

  estiloCabecera(sheet)
  const ultimaColumna = String.fromCharCode(64 + COLUMNAS.length)
  sheet.autoFilter = { from: 'A1', to: `${ultimaColumna}${Math.max(proveedores.length + 1, 1)}` }
  sheet.getCell('A1').note = 'No modificar. Dejar vacío para agregar un proveedor nuevo.'
  sheet.getCell(1, COLUMNAS.length).note =
    'Solo para repetidos: poné el ID del proveedor que queda. Sus movimientos pasan a ese y este se elimina.'

  const ultimaFila = proveedores.length + 1 + FILAS_EXTRA_VALIDACION
  for (const clave of COLUMNAS_TEXTO) {
    const col = COLUMNAS.findIndex(c => c.key === clave) + 1
    sheet.getColumn(col).numFmt = '@'
    for (let r = 2; r <= ultimaFila; r++) sheet.getCell(r, col).numFmt = '@'
  }
  const colActivo = String.fromCharCode(64 + COLUMNAS.findIndex(c => c.key === 'activo') + 1)
  const dataValidations = (sheet as unknown as { dataValidations: DataValidationsModel }).dataValidations
  dataValidations.add(`${colActivo}2:${colActivo}${ultimaFila}`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"Sí,No"'],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Valor inválido',
    error: 'Elegí Sí o No.',
  })
  pintarColumnasEspeciales(sheet, ultimaFila, COLUMNAS.length)

  agregarInstrucciones(workbook, INSTRUCCIONES)
  return workbook
}

// ─────────────────────────────────────────────────────────────
//  Importar: planificar (no escribe)
// ─────────────────────────────────────────────────────────────

function mapearColumnas(hoja: ExcelJS.Worksheet): Partial<Record<ClaveColumna, number>> {
  const mapa: Partial<Record<ClaveColumna, number>> = {}
  hoja.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const texto = normalizar(textoCelda(cell))
    for (const clave of Object.keys(ALIAS_COLUMNAS) as ClaveColumna[]) {
      if (mapa[clave] === undefined && ALIAS_COLUMNAS[clave].includes(texto)) mapa[clave] = col
    }
  })
  const faltantes = COLUMNAS_REQUERIDAS.filter(c => mapa[c] === undefined)
  if (faltantes.length > 0) {
    const nombres = faltantes.map(c => `"${COLUMNAS.find(x => x.key === c)!.header}"`).join(', ')
    throw new ErrorArchivoProveedores(
      `Faltan columnas en la hoja "${hoja.name}": ${nombres}. Usá el archivo exportado desde el sistema.`,
    )
  }
  return mapa
}

/** Un CBU de 22 dígitos escrito como número pierde los últimos dígitos en Excel */
function cbuDeformado(cell: ExcelJS.Cell | undefined): boolean {
  return typeof cell?.value === 'number' && Math.abs(cell.value) >= 1e15
}

export async function planificarImportacion(
  buffer: Buffer,
): Promise<{ preview: PreviewProveedores; operaciones: Operaciones }> {
  let workbook: ExcelJS.Workbook
  try {
    workbook = (await cargarWorkbook(buffer)).workbook
  } catch {
    throw new ErrorArchivoProveedores(
      'No se pudo leer el archivo. Verificá que sea un .xlsx válido y que no esté dañado.',
    )
  }
  const hoja =
    workbook.worksheets.find(ws => normalizar(ws.name) === normalizar(HOJA_PROVEEDORES)) ??
    workbook.worksheets.find(ws => ws.state === 'visible') ??
    workbook.worksheets[0]
  if (!hoja) throw new ErrorArchivoProveedores('El archivo no tiene hojas.')
  return planificarConProveedores(hoja, mapearColumnas(hoja), buffer, await cargarProveedores())
}

function planificarConProveedores(
  hoja: ExcelJS.Worksheet,
  columnas: Partial<Record<ClaveColumna, number>>,
  buffer: Buffer,
  proveedores: ProveedorDB[],
): { preview: PreviewProveedores; operaciones: Operaciones } {
  const porId = new Map(proveedores.map(p => [p.id, p]))
  const errores: MensajeFila[] = []
  const advertencias: MensajeFila[] = []
  const altas: FilaAlta[] = []
  const modificaciones: FilaModificacion[] = []
  const operaciones: Operaciones = { insertar: [], actualizar: [], eliminar: [], unificar: [] }
  const pedidosUnificar: PedidoUnificar[] = []
  const filaPorId = new Map<number, number>()
  const filasPorNombre = new Map<string, FilaNombre[]>()
  let filasConDatos = 0
  let sinCambios = 0

  const celda = (row: ExcelJS.Row, clave: ClaveColumna) => {
    const col = columnas[clave]
    return col === undefined ? undefined : row.getCell(col)
  }
  const leer = (row: ExcelJS.Row, clave: ClaveColumna) => textoCelda(celda(row, clave))

  for (let r = 2; r <= hoja.rowCount; r++) {
    const row = hoja.getRow(r)
    const crudo = Object.fromEntries(COLUMNAS.map(c => [c.key, leer(row, c.key)])) as Record<ClaveColumna, string>
    if (Object.values(crudo).every(v => v === '')) continue

    filasConDatos++
    if (filasConDatos > MAX_FILAS) {
      throw new ErrorArchivoProveedores(`El archivo tiene más de ${MAX_FILAS} filas con datos.`)
    }

    const erroresFila: string[] = []

    // ── ID ──
    let existente: ProveedorDB | undefined
    if (crudo.id) {
      const id = Number(crudo.id)
      if (!Number.isInteger(id) || id <= 0) {
        erroresFila.push(`ID "${crudo.id}" inválido. Para un proveedor nuevo dejá el ID vacío.`)
      } else if (filaPorId.has(id)) {
        erroresFila.push(`El ID ${id} está repetido (también en la fila ${filaPorId.get(id)}).`)
      } else {
        filaPorId.set(id, r)
        existente = porId.get(id)
        if (!existente) {
          erroresFila.push(
            `El ID ${id} no existe en el sistema (¿se eliminó o se modificó el ID?). Para un proveedor nuevo dejá el ID vacío.`,
          )
        }
      }
    }

    // ── Unificar: el resto de la fila no se valida porque el proveedor se va a eliminar ──
    if (crudo.unificar) {
      if (!crudo.id) erroresFila.push('Solo se puede unificar un proveedor que ya existe: falta el ID.')
      if (erroresFila.length > 0) {
        for (const mensaje of erroresFila) errores.push({ fila: r, mensaje })
      } else if (existente) {
        pedidosUnificar.push({ fila: r, id: existente.id, destinoCrudo: crudo.unificar })
      }
      continue
    }

    // ── Datos: mismas reglas que el formulario ──
    const validacion = validarDatosProveedor(crudo)
    if (validacion.error) erroresFila.push(validacion.error)
    if (crudo.nombre.length > 255) erroresFila.push('El nombre supera los 255 caracteres.')
    if (cbuDeformado(celda(row, 'cbu_alias'))) {
      erroresFila.push('El CBU se cargó como número y Excel le cambió los últimos dígitos. Escribilo como texto.')
    }

    let activo: 0 | 1 = existente ? existente.activo : 1
    const activoParseado = parsearActivo(crudo.activo)
    if (activoParseado === 'invalido') erroresFila.push(`Activo "${crudo.activo}" inválido. Usá Sí o No.`)
    else if (activoParseado !== null) activo = activoParseado

    if (erroresFila.length > 0 || !validacion.datos) {
      for (const mensaje of erroresFila) errores.push({ fila: r, mensaje })
      continue
    }

    const nuevo: ValoresProveedor = { ...validacion.datos, activo }
    const claveNombre = normalizar(nuevo.nombre)
    filasPorNombre.set(claveNombre, [
      ...(filasPorNombre.get(claveNombre) ?? []),
      { fila: r, id: existente?.id ?? null },
    ])

    const actual = existente
    if (actual) {
      const cambios: CambioCampo[] = CAMPOS.filter(c => (actual[c.key] ?? '') !== (nuevo[c.key] ?? '')).map(c => ({
        campo: c.label,
        antes: mostrar(c.key, actual[c.key]),
        despues: mostrar(c.key, nuevo[c.key]),
      }))
      if (actual.activo !== nuevo.activo) {
        cambios.push({ campo: 'Activo', antes: actual.activo ? 'Sí' : 'No', despues: nuevo.activo ? 'Sí' : 'No' })
      }
      if (cambios.length === 0) {
        sinCambios++
      } else {
        modificaciones.push({ fila: r, id: actual.id, nombre: nuevo.nombre, cambios })
        operaciones.actualizar.push({ id: actual.id, ...nuevo })
      }
    } else {
      altas.push({ fila: r, nombre: nuevo.nombre, cuit: nuevo.cuit ?? '', activo: nuevo.activo === 1 })
      operaciones.insertar.push(nuevo)
    }
  }

  if (filasConDatos === 0) {
    throw new ErrorArchivoProveedores(
      'El archivo no tiene proveedores. Si de verdad querés eliminarlos todos, hacelo desde el sistema.',
    )
  }

  for (const [, filas] of filasPorNombre) {
    if (filas.length > 1) advertencias.push(avisoNombreRepetido(filas))
  }

  const unificadas = resolverUnificaciones(pedidosUnificar, porId, new Set(filaPorId.keys()))
  errores.push(...unificadas.errores)
  operaciones.unificar = unificadas.operaciones

  const bajas: FilaBaja[] = proveedores
    .filter(p => !filaPorId.has(p.id))
    .map(p => ({ id: p.id, nombre: p.nombre, cuit: p.cuit ?? '', movimientos: p.movimientos }))
  operaciones.eliminar = bajas.map(b => b.id)

  const bajasConMovimientos = bajas.filter(b => b.movimientos > 0)
  if (bajasConMovimientos.length > 0) {
    advertencias.push({
      fila: null,
      mensaje: `${bajasConMovimientos.length} de los proveedores que se eliminan tienen movimientos, que van a quedar sin proveedor. Si son repetidos, volvé a poner la fila y completá "${ENCABEZADO_UNIFICAR}".`,
    })
  }

  const preview: PreviewProveedores = {
    archivo_hash: sha256(buffer),
    firma: sha256(Buffer.from(JSON.stringify(operaciones))),
    resumen: {
      filas: filasConDatos,
      altas: altas.length,
      modificaciones: modificaciones.length,
      bajas: bajas.length,
      unificaciones: unificadas.unificaciones.length,
      sin_cambios: sinCambios,
      errores: errores.length,
      advertencias: advertencias.length,
    },
    altas,
    modificaciones,
    bajas,
    unificaciones: unificadas.unificaciones,
    errores,
    advertencias,
  }
  return { preview, operaciones }
}

// ─────────────────────────────────────────────────────────────
//  Importar: aplicar
// ─────────────────────────────────────────────────────────────

const valoresFila = (p: ValoresProveedor) => [
  p.nombre,
  p.razon_social,
  p.cuit,
  p.cbu_alias,
  p.telefono,
  p.email,
  p.direccion,
  p.activo,
]

export async function aplicarOperaciones(operaciones: Operaciones): Promise<void> {
  const connection = await getConnection()
  try {
    await connection.beginTransaction()

    // Primero las unificaciones: los movimientos pasan al que queda y el repetido se borra
    for (const u of operaciones.unificar) {
      await connection.query('UPDATE movimientos SET proveedor_id = ? WHERE proveedor_id = ?', [u.destino, u.origen])
      await connection.query('DELETE FROM proveedores WHERE id = ?', [u.origen])
    }

    if (operaciones.eliminar.length > 0) {
      await connection.query('DELETE FROM proveedores WHERE id IN (?)', [operaciones.eliminar])
    }

    for (const p of operaciones.actualizar) {
      await connection.query(
        `UPDATE proveedores
         SET nombre = ?, razon_social = ?, cuit = ?, cbu_alias = ?, telefono = ?, email = ?, direccion = ?, activo = ?
         WHERE id = ?`,
        [...valoresFila(p), p.id],
      )
    }

    if (operaciones.insertar.length > 0) {
      await connection.query(
        'INSERT INTO proveedores (nombre, razon_social, cuit, cbu_alias, telefono, email, direccion, activo) VALUES ?',
        [operaciones.insertar.map(valoresFila)],
      )
    }

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
