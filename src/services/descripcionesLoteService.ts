import {
  Catalogos,
  Tipo,
  ValoresDescripcion,
  aplicarOperaciones,
  cargarCatalogos,
  limpiar,
} from './descripcionesExcelService'

/**
 * Guardado en lote desde la grilla editable de Configuración > Descripciones.
 *
 * Se valida todo el lote contra los catálogos actuales y, si hay al menos un
 * error, no se guarda nada: el usuario corrige en la grilla y vuelve a guardar.
 * Las reglas son las mismas que el formulario y que la importación Excel.
 */

export interface ItemLote {
  id: number
  nombre: string
  tipo: Tipo | null
  categoria_id: number | null
  subcategoria_id: number | null
  activo: boolean | number
}

export interface ErrorLote {
  id: number
  nombre: string
  mensaje: string
}

const LIMITE_LOTE = 2000

function aNumeroONull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : NaN
}

/** Puro (sin base de datos) para poder probarlo. */
export function validarLote(
  items: unknown,
  { descripciones, categorias, subcategorias }: Catalogos,
): { errores: ErrorLote[]; actualizar: (ValoresDescripcion & { id: number })[] } {
  if (!Array.isArray(items) || items.length === 0) {
    return { errores: [{ id: 0, nombre: '', mensaje: 'No hay cambios para guardar.' }], actualizar: [] }
  }
  if (items.length > LIMITE_LOTE) {
    return {
      errores: [{ id: 0, nombre: '', mensaje: `No se pueden guardar más de ${LIMITE_LOTE} cambios juntos.` }],
      actualizar: [],
    }
  }

  const descripcionesPorId = new Map(descripciones.map(d => [d.id, d]))
  const categoriasPorId = new Map(categorias.map(c => [c.id, c]))
  const subcategoriasPorId = new Map(subcategorias.map(s => [s.id, s]))

  const errores: ErrorLote[] = []
  const actualizar: (ValoresDescripcion & { id: number })[] = []
  const vistos = new Set<number>()

  for (const raw of items as Partial<ItemLote>[]) {
    const id = Number(raw?.id)
    const nombre = limpiar(String(raw?.nombre ?? ''))
    const etiqueta = nombre || `#${raw?.id ?? '?'}`
    const err = (mensaje: string) => errores.push({ id: Number.isInteger(id) ? id : 0, nombre: etiqueta, mensaje })

    if (!Number.isInteger(id) || id <= 0) {
      err('ID inválido.')
      continue
    }
    if (vistos.has(id)) {
      err('La descripción viene repetida en el lote.')
      continue
    }
    vistos.add(id)

    const actual = descripcionesPorId.get(id)
    if (!actual) {
      err('La descripción ya no existe (puede que otro usuario la haya eliminado). Recargá la página.')
      continue
    }

    const antes = errores.length

    if (!nombre) err('Falta el nombre.')
    else if (nombre.length > 255) err('El nombre supera los 255 caracteres.')

    let tipo: Tipo | null = null
    if (raw.tipo === 'ingreso' || raw.tipo === 'egreso') tipo = raw.tipo
    else if (raw.tipo === null || raw.tipo === undefined || (raw.tipo as unknown) === '') {
      if (actual.tipo !== null) err('Falta el tipo (Ingreso o Egreso).')
    } else err('Tipo inválido.')

    const activo: 0 | 1 = raw.activo === false || raw.activo === 0 ? 0 : 1

    const categoriaId = aNumeroONull(raw.categoria_id)
    const subcategoriaId = aNumeroONull(raw.subcategoria_id)
    if (Number.isNaN(categoriaId) || Number.isNaN(subcategoriaId)) {
      err('Categoría o subcategoría inválida.')
    } else if (categoriaId === null) {
      if (subcategoriaId !== null) err('Hay subcategoría pero falta la categoría.')
    } else {
      const categoria = categoriasPorId.get(categoriaId)
      if (!categoria) err('La categoría elegida ya no existe.')
      else {
        if (tipo && categoria.tipo && categoria.tipo !== tipo)
          err(`La categoría "${categoria.nombre}" es de ${categoria.tipo} y la descripción es de ${tipo}.`)
        if (subcategoriaId !== null) {
          const sub = subcategoriasPorId.get(subcategoriaId)
          if (!sub) err('La subcategoría elegida ya no existe.')
          else if (sub.categoria_id !== categoria.id)
            err(`La subcategoría "${sub.nombre}" no pertenece a "${categoria.nombre}".`)
        }
      }
    }

    if (errores.length > antes) continue

    actualizar.push({
      id,
      nombre,
      tipo,
      categoria_id: categoriaId,
      subcategoria_id: subcategoriaId,
      activo,
    })
  }

  return { errores, actualizar }
}

export async function guardarLote(items: unknown): Promise<{ errores: ErrorLote[]; actualizadas: number }> {
  const { errores, actualizar } = validarLote(items, await cargarCatalogos())
  if (errores.length > 0) return { errores, actualizadas: 0 }
  await aplicarOperaciones({ insertar: [], actualizar, eliminar: [] })
  return { errores: [], actualizadas: actualizar.length }
}
