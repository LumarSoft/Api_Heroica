import { query } from '../../config/database'
import type { DestinoMapeo, ReglaConcepto } from './types'

/**
 * ============================================================
 *  RESOLUTOR DE CATÁLOGOS
 * ============================================================
 *
 * Las reglas de mapeo referencian los catálogos POR NOMBRE (ver `types.ts`).
 * Este módulo los traduce a los IDs de la base en tiempo de ejecución.
 *
 * Por qué por nombre y no por ID: los IDs difieren entre `heroica_oficial` y
 * `heroica_prueba`. Una regla con un ID hardcodeado funcionaría en una base y
 * clasificaría mal los movimientos en la otra, sin dar error. Con nombres, si
 * algo no coincide, falla ruidosamente antes de tocar la caja.
 *
 * La comparación ignora mayúsculas, tildes y espacios de más, porque los nombres
 * los escribió el cliente en una planilla ("Debito automatico" vs "Débito
 * automático"). Lo que NO hace es crear catálogos faltantes: si un nombre no
 * existe, es un error de configuración que alguien tiene que mirar.
 */

/** Normaliza para comparar: sin tildes, sin mayúsculas, sin espacios dobles. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export interface Catalogos {
  /** nombre normalizado → id */
  categorias: Map<string, number>
  /** "categoriaNormalizada|subcategoriaNormalizada" → id */
  subcategorias: Map<string, number>
  /**
   * nombre normalizado → candidatos. Es una lista y no un id porque en la base
   * hay descripciones duplicadas por nombre (ej. "Iva" sin tipo e "IVA" como
   * egreso). Quedarse con una al azar clasificaría movimientos distinto según
   * el orden que devuelva MySQL, así que el desempate se hace explícito en
   * `resolverDestino`.
   */
  descripciones: Map<string, Array<{ id: number; nombre: string; tipo: string | null }>>
  mediosPago: Map<string, number>
  proveedores: Map<string, number>
}

/** Carga los catálogos activos de la base. Una consulta por tabla, se cachea por request. */
export async function cargarCatalogos(): Promise<Catalogos> {
  const [cats, subs, descs, medios, provs]: any[] = await Promise.all([
    query('SELECT id, nombre FROM categorias WHERE deleted_at IS NULL'),
    query(
      `SELECT s.id, s.nombre, c.nombre AS categoria_nombre
       FROM subcategorias s
       JOIN categorias c ON s.categoria_id = c.id AND c.deleted_at IS NULL
       WHERE s.deleted_at IS NULL`,
    ),
    query('SELECT id, nombre, tipo FROM descripciones WHERE deleted_at IS NULL ORDER BY id'),
    query('SELECT id, nombre FROM medios_pago WHERE deleted_at IS NULL'),
    // OJO: `proveedores` no tiene columna `deleted_at` (a diferencia del resto de
    // los catálogos). Se consulta entera, igual que hace configuracionController.
    query('SELECT id, nombre FROM proveedores'),
  ])

  const catalogos: Catalogos = {
    categorias: new Map(),
    subcategorias: new Map(),
    descripciones: new Map(),
    mediosPago: new Map(),
    proveedores: new Map(),
  }

  for (const c of cats) catalogos.categorias.set(normalizar(c.nombre), c.id)
  for (const s of subs) {
    catalogos.subcategorias.set(`${normalizar(s.categoria_nombre)}|${normalizar(s.nombre)}`, s.id)
  }
  for (const d of descs) {
    const clave = normalizar(d.nombre)
    const lista = catalogos.descripciones.get(clave) ?? []
    lista.push({ id: d.id, nombre: d.nombre, tipo: d.tipo ?? null })
    catalogos.descripciones.set(clave, lista)
  }
  for (const m of medios) catalogos.mediosPago.set(normalizar(m.nombre), m.id)
  for (const p of provs) catalogos.proveedores.set(normalizar(p.nombre), p.id)

  return catalogos
}

export interface DestinoResuelto {
  categoria_id: number
  subcategoria_id: number
  descripcion_id: number
  medio_pago_id: number
  proveedor_id: number | null
}

/** Un nombre de las reglas que no existe en la base. */
export interface FaltanteCatalogo {
  catalogo: 'categoría' | 'subcategoría' | 'descripción' | 'medio de pago' | 'proveedor'
  valor: string
  /** Códigos de concepto de las reglas que lo usan, para saber qué corregir. */
  usadoPor: string[]
}

/**
 * Resuelve un destino contra los catálogos. Devuelve los faltantes en vez de
 * lanzar, para poder juntar TODOS los problemas de una vez y mostrárselos al
 * usuario en una sola pasada.
 */
export function resolverDestino(
  destino: DestinoMapeo,
  catalogos: Catalogos,
): { resuelto: DestinoResuelto | null; faltantes: Omit<FaltanteCatalogo, 'usadoPor'>[] } {
  const faltantes: Omit<FaltanteCatalogo, 'usadoPor'>[] = []

  const categoriaId = catalogos.categorias.get(normalizar(destino.categoria))
  if (categoriaId === undefined) faltantes.push({ catalogo: 'categoría', valor: destino.categoria })

  const subcategoriaId = catalogos.subcategorias.get(
    `${normalizar(destino.categoria)}|${normalizar(destino.subcategoria)}`,
  )
  if (subcategoriaId === undefined) {
    faltantes.push({ catalogo: 'subcategoría', valor: `${destino.categoria} > ${destino.subcategoria}` })
  }

  const descripcionId = elegirDescripcion(catalogos, destino.descripcion, destino.tipoEsperado)
  if (descripcionId === undefined) faltantes.push({ catalogo: 'descripción', valor: destino.descripcion })

  const medioPagoId = catalogos.mediosPago.get(normalizar(destino.medioPago))
  if (medioPagoId === undefined) faltantes.push({ catalogo: 'medio de pago', valor: destino.medioPago })

  let proveedorId: number | null = null
  if (destino.proveedor) {
    const id = catalogos.proveedores.get(normalizar(destino.proveedor))
    if (id === undefined) faltantes.push({ catalogo: 'proveedor', valor: destino.proveedor })
    else proveedorId = id
  }

  if (faltantes.length > 0) return { resuelto: null, faltantes }

  return {
    resuelto: {
      categoria_id: categoriaId!,
      subcategoria_id: subcategoriaId!,
      descripcion_id: descripcionId!,
      medio_pago_id: medioPagoId!,
      proveedor_id: proveedorId,
    },
    faltantes: [],
  }
}

/**
 * Elige una descripción cuando hay varias con el mismo nombre. Prioridad:
 *   1. Coincidencia exacta de texto (respetando mayúsculas y tildes).
 *   2. La que tenga el mismo tipo (ingreso/egreso) que el destino.
 *   3. La de menor id — el desempate final, para que el resultado sea siempre
 *      el mismo corrida tras corrida.
 */
function elegirDescripcion(
  catalogos: Catalogos,
  nombre: string,
  tipoEsperado: 'ingreso' | 'egreso',
): number | undefined {
  const candidatos = catalogos.descripciones.get(normalizar(nombre))
  if (!candidatos || candidatos.length === 0) return undefined
  if (candidatos.length === 1) return candidatos[0].id

  const exacta = candidatos.find(c => c.nombre === nombre)
  if (exacta) return exacta.id

  const porTipo = candidatos.find(c => c.tipo === tipoEsperado)
  if (porTipo) return porTipo.id

  return candidatos.reduce((min, c) => (c.id < min.id ? c : min)).id
}

/**
 * Valida TODAS las reglas de un banco contra los catálogos, de una sola vez.
 *
 * Se llama al hacer el preview: es preferible fallar ahí, con la lista completa
 * de lo que hay que corregir, que descubrir el problema a mitad de la inserción.
 */
export function validarReglas(reglas: ReadonlyMap<string, ReglaConcepto>, catalogos: Catalogos): FaltanteCatalogo[] {
  const porClave = new Map<string, FaltanteCatalogo>()

  for (const regla of reglas.values()) {
    if (regla.accion !== 'importar' || !regla.destino) continue

    const { faltantes } = resolverDestino(regla.destino, catalogos)
    for (const f of faltantes) {
      const clave = `${f.catalogo}|${f.valor}`
      const existente = porClave.get(clave)
      if (existente) existente.usadoPor.push(regla.codigo)
      else porClave.set(clave, { ...f, usadoPor: [regla.codigo] })
    }
  }

  return [...porClave.values()]
}

/** Arma un mensaje legible con los catálogos faltantes. */
export function mensajeFaltantes(faltantes: FaltanteCatalogo[]): string {
  const lineas = faltantes.map(f => `  · ${f.catalogo}: "${f.valor}" (la usan los conceptos ${f.usadoPor.join(', ')})`)
  return (
    `Las reglas de mapeo referencian catálogos que no existen en la base:\n${lineas.join('\n')}\n` +
    `Creálos en Configuración, o corregí los nombres en el archivo de reglas del banco.`
  )
}
