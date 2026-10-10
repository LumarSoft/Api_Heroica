import { query } from '../config/database'

/**
 * Plantilla global del "Corte de balance mensual".
 *
 * Define cómo se agrupan los egresos del sistema en secciones y líneas del
 * reporte. Cada línea suma los movimientos que coinciden con sus reglas
 * (categoría, subcategoría o descripción, opcionalmente filtrando por medio).
 * La clasificación en sí la hace el front para que los cambios se vean al
 * instante; acá solo se valida, se guarda y se arma la plantilla por defecto.
 */

export type TipoRegla = 'categoria' | 'subcategoria' | 'descripcion'
export type MedioRegla = 'banco' | 'efectivo' | null
/** Para el punto de equilibrio: los fijos no dependen del nivel de ventas. */
export type TipoCosto = 'fijo' | 'variable'

export interface ReglaPlantilla {
  tipo: TipoRegla
  id: number
  medio: MedioRegla
}

export interface LineaPlantilla {
  id: string
  nombre: string
  reglas: ReglaPlantilla[]
}

export interface SeccionPlantilla {
  id: string
  nombre: string
  detalle: string
  tipoCosto: TipoCosto
  lineas: LineaPlantilla[]
}

export interface PlantillaCorteBalance {
  version: 1
  secciones: SeccionPlantilla[]
  excluidas: ReglaPlantilla[]
  operatividadPct: number
}

const CLAVE_PLANTILLA = 'corte_balance_mensual'

const LIMITES = { secciones: 40, lineas: 60, reglas: 300, nombre: 120, detalle: 3000, id: 60 }

// ── Validación ──────────────────────────────────────────────────────────────

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function texto(v: unknown, max: number, campo: string, obligatorio = true): string {
  if (typeof v !== 'string') throw new Error(`${campo}: debe ser texto`)
  const limpio = v.trim()
  if (obligatorio && !limpio) throw new Error(`${campo}: no puede estar vacío`)
  if (limpio.length > max) throw new Error(`${campo}: máximo ${max} caracteres`)
  return limpio
}

function validarReglas(v: unknown, campo: string): ReglaPlantilla[] {
  if (!Array.isArray(v)) throw new Error(`${campo}: debe ser una lista`)
  if (v.length > LIMITES.reglas) throw new Error(`${campo}: máximo ${LIMITES.reglas} reglas`)
  return v.map((r, i) => {
    if (!esObjeto(r)) throw new Error(`${campo}[${i}]: regla inválida`)
    if (r.tipo !== 'categoria' && r.tipo !== 'subcategoria' && r.tipo !== 'descripcion') {
      throw new Error(`${campo}[${i}]: tipo inválido`)
    }
    const id = Number(r.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${campo}[${i}]: id inválido`)
    const medio = r.medio === 'banco' || r.medio === 'efectivo' ? r.medio : null
    return { tipo: r.tipo, id, medio }
  })
}

/** Puro (sin base de datos): valida y normaliza lo que llega del front. */
export function validarPlantilla(v: unknown): PlantillaCorteBalance {
  if (!esObjeto(v)) throw new Error('Plantilla inválida')
  if (!Array.isArray(v.secciones) || v.secciones.length === 0) throw new Error('La plantilla necesita secciones')
  if (v.secciones.length > LIMITES.secciones) throw new Error(`Máximo ${LIMITES.secciones} secciones`)

  const ids = new Set<string>()
  const idUnico = (raw: unknown, campo: string) => {
    const id = texto(raw, LIMITES.id, campo)
    if (ids.has(id)) throw new Error(`${campo}: id repetido (${id})`)
    ids.add(id)
    return id
  }

  const secciones = v.secciones.map((s, i): SeccionPlantilla => {
    if (!esObjeto(s)) throw new Error(`Sección ${i + 1}: inválida`)
    if (!Array.isArray(s.lineas)) throw new Error(`Sección ${i + 1}: líneas inválidas`)
    if (s.lineas.length > LIMITES.lineas) throw new Error(`Sección ${i + 1}: máximo ${LIMITES.lineas} líneas`)
    return {
      id: idUnico(s.id, `Sección ${i + 1}`),
      nombre: texto(s.nombre, LIMITES.nombre, `Sección ${i + 1}`),
      detalle: typeof s.detalle === 'string' ? texto(s.detalle, LIMITES.detalle, `Sección ${i + 1}`, false) : '',
      tipoCosto: s.tipoCosto === 'variable' ? 'variable' : 'fijo',
      lineas: s.lineas.map((l, j): LineaPlantilla => {
        const campo = `Sección ${i + 1}, línea ${j + 1}`
        if (!esObjeto(l)) throw new Error(`${campo}: inválida`)
        return {
          id: idUnico(l.id, campo),
          nombre: texto(l.nombre, LIMITES.nombre, campo),
          reglas: validarReglas(l.reglas, campo),
        }
      }),
    }
  })

  const pct = Number(v.operatividadPct)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Operatividad: porcentaje entre 0 y 100')

  return { version: 1, secciones, excluidas: validarReglas(v.excluidas ?? [], 'Excluidas'), operatividadPct: pct }
}

// ── Plantilla por defecto (Corte de balance Julio 2026) ─────────────────────

interface CatalogoNombre {
  id: number
  nombre: string
  categoria_id?: number | null
}

interface CatalogoEgresos {
  categorias: CatalogoNombre[]
  subcategorias: CatalogoNombre[]
  descripciones: CatalogoNombre[]
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

// Cada línea: [nombre, reglas por nombre]. `cat:`, `sub:` y `desc:` indican el
// nivel; `@banco` / `@efectivo` filtran por medio; `sub:CATEGORIA/Sub` acota la
// subcategoría a una categoría. Los nombres repetidos en el catálogo (p. ej.
// dos "Internet") generan una regla por cada id.
type LineaPorDefecto = [string, string[]]
type SeccionPorDefecto = { nombre: string; detalle?: string; tipoCosto: TipoCosto; lineas: LineaPorDefecto[] }

const SUELDOS = ['sub:Sueldo colaboradores', 'sub:Sueldo gerente', 'sub:Sueldo Administración']

const SECCIONES_POR_DEFECTO: SeccionPorDefecto[] = [
  {
    nombre: 'Gastos Fijos',
    tipoCosto: 'fijo',
    lineas: [
      ['Alquiler', ['sub:Alquileres']],
      ['Expensas', ['desc:Expensas']],
      ['Aguas', ['desc:Aguas']],
      ['EPE', ['desc:Epe Comercial']],
      ['Internet', ['desc:Internet']],
      ['Cleancity', ['desc:Clean City']],
      ['Redes', ['desc:Jose redes']],
      ['Higiene y Seguridad', ['desc:Dell Alquilla Hernan']],
      ['OpenWings', ['desc:Crous Pablo', 'desc:Bernardo Open Wings']],
      ['Sistema', ['desc:Lucas Quaroni', 'desc:Lumar']],
      ['Estudio Contable', ['desc:Estudio Sanchez']],
      ['Estudio Jurídico', ['desc:Patricia abogada']],
      ['Bromatología', ['desc:Flavia Ruiz', 'desc:bromatologa']],
      ['Sistema de venta', ['desc:Hiopos', 'desc:Bistrosoft']],
      ['Fumigación', ['desc:Fumigacion']],
    ],
  },
  {
    nombre: 'Sueldos',
    tipoCosto: 'fijo',
    lineas: [
      ['Sueldos Bancarios', SUELDOS.map(r => `${r}@banco`)],
      ['Sueldos Efectivo', SUELDOS.map(r => `${r}@efectivo`)],
      ['SUSS', ['sub:SUSS']],
      ['Sindicato', ['sub:Sindicato']],
      ['ART', ['sub:ART', 'desc:arca']],
      ['Liquidaciones finales', ['sub:Liquidaciones finales']],
    ],
  },
  {
    nombre: 'Gastos Productivos',
    tipoCosto: 'variable',
    detalle:
      'Compras de materias primas: se incluyen las compras a proveedores directos, que reparten la mercadería directamente en sucursal.\n' +
      'Compra de mercadería: se incluyen las compras realizadas al obrador.',
    lineas: [
      ['Compras Materia Prima', ['sub:Mercaderia para produccion']],
      ['Compra Mercadería', ['sub:Productos terminados']],
    ],
  },
  {
    nombre: 'Gastos No Productivos',
    tipoCosto: 'variable',
    detalle:
      'Limpieza: se incluyen todos los artículos de limpieza, tanto del sector de sitting como del sector productivo.\n' +
      'Papelería: se incluyen todos los artículos descartables para producción, vitrina, take away y operatividad diaria.',
    lineas: [
      ['Limpieza', ['sub:Limpieza']],
      ['Papelería', ['sub:Papelería']],
    ],
  },
  {
    nombre: 'Gastos Administrativos',
    tipoCosto: 'fijo',
    lineas: [
      ['Gastos administrativos', ['sub:ADMINISTRACION VARIABLE/Administrativo']],
      ['Informe Eléctrico', ['desc:informe electrico']],
      ['Diferencias de caja', ['sub:Diferencia de caja efectivo']],
    ],
  },
  // El royalty y las comisiones/impuestos se mueven con las ventas
  { nombre: 'Gastos Franquicia', tipoCosto: 'variable', lineas: [['Royalty', ['sub:Royalty']]] },
  {
    nombre: 'Gastos Operativos',
    tipoCosto: 'fijo',
    detalle:
      'Gastos de caja: corresponden a gastos efectuados diariamente desde caja, auditados en cada arqueo con su documento respaldatorio o autorizados por un responsable.',
    lineas: [
      ['Servicio Sodera', ['desc:Gassata']],
      ['Mantenimiento', ['sub:Mantenimiento']],
      ['Gastos de caja', []],
    ],
  },
  {
    nombre: 'Gastos Marketing',
    tipoCosto: 'fijo',
    lineas: [
      ['Agencia', ['sub:Marketing']],
      ['Insumos', ['desc:Dario Churin']],
    ],
  },
  {
    nombre: 'Gastos Bancarios y Financieros',
    tipoCosto: 'variable',
    lineas: [['Comisiones bancarias', ['cat:FINANCIERO']]],
  },
  {
    nombre: 'Gastos Impositivos',
    tipoCosto: 'variable',
    lineas: [
      ['Ingresos Brutos', ['sub:IIBB/CM']],
      ['IVA', ['sub:IVA']],
      ['DREI', ['sub:DREI']],
      ['ETUR', ['sub:ETUR']],
      ['Anticipo de Ganancias', ['sub:Anticipo de ganancias', 'sub:Impuesto a las ganancias']],
    ],
  },
]

// En el Canva de Julio el alquiler de oficina no se imputa a la sucursal.
const EXCLUIDAS_POR_DEFECTO = ['desc:Alquiler oficina']

const slug = (s: string) =>
  normalizar(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

function resolverReglas(claves: string[], catalogo: CatalogoEgresos): ReglaPlantilla[] {
  const indices: Record<TipoRegla, Map<string, number[]>> = {
    categoria: new Map(),
    subcategoria: new Map(),
    descripcion: new Map(),
  }
  const cargar = (tipo: TipoRegla, items: CatalogoNombre[]) => {
    for (const item of items) {
      const k = normalizar(item.nombre)
      indices[tipo].set(k, [...(indices[tipo].get(k) ?? []), item.id])
    }
  }
  cargar('categoria', catalogo.categorias)
  cargar('subcategoria', catalogo.subcategorias)
  cargar('descripcion', catalogo.descripciones)
  const categoriasPorId = new Map(catalogo.categorias.map(c => [c.id, c.nombre]))
  cargar(
    'subcategoria',
    catalogo.subcategorias.map(sub => ({
      id: sub.id,
      nombre: `${categoriasPorId.get(sub.categoria_id ?? 0) ?? ''}/${sub.nombre}`,
    })),
  )

  const prefijos: Record<string, TipoRegla> = { cat: 'categoria', sub: 'subcategoria', desc: 'descripcion' }
  return claves.flatMap(clave => {
    const [cuerpo, medioRaw] = clave.split('@')
    const sep = cuerpo.indexOf(':')
    const tipo = prefijos[cuerpo.slice(0, sep)]
    const medio: MedioRegla = medioRaw === 'banco' || medioRaw === 'efectivo' ? medioRaw : null
    const ids = indices[tipo].get(normalizar(cuerpo.slice(sep + 1))) ?? []
    return ids.map(id => ({ tipo, id, medio }))
  })
}

export function construirPlantillaPorDefecto(catalogo: CatalogoEgresos): PlantillaCorteBalance {
  return {
    version: 1,
    operatividadPct: 20,
    excluidas: resolverReglas(EXCLUIDAS_POR_DEFECTO, catalogo),
    secciones: SECCIONES_POR_DEFECTO.map(s => ({
      id: slug(s.nombre),
      nombre: s.nombre,
      detalle: s.detalle ?? '',
      tipoCosto: s.tipoCosto,
      lineas: s.lineas.map(([nombre, reglas]) => ({
        id: `${slug(s.nombre)}--${slug(nombre)}`,
        nombre,
        reglas: resolverReglas(reglas, catalogo),
      })),
    })),
  }
}

// ── Persistencia ────────────────────────────────────────────────────────────

export async function cargarCatalogoEgresos(): Promise<CatalogoEgresos> {
  const [categorias, subcategorias, descripciones] = (await Promise.all([
    query(`SELECT id, nombre FROM categorias WHERE tipo = 'egreso' AND deleted_at IS NULL ORDER BY nombre`),
    query(
      `SELECT s.id, s.nombre, s.categoria_id FROM subcategorias s
       JOIN categorias c ON c.id = s.categoria_id
       WHERE c.tipo = 'egreso' AND s.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY s.nombre`,
    ),
    query(
      `SELECT id, nombre, categoria_id, subcategoria_id FROM descripciones
       WHERE deleted_at IS NULL AND (tipo = 'egreso' OR tipo IS NULL) ORDER BY nombre`,
    ),
  ])) as [CatalogoNombre[], CatalogoNombre[], CatalogoNombre[]]
  return { categorias, subcategorias, descripciones }
}

const esTablaInexistente = (err: unknown) =>
  err instanceof Error && 'code' in err && (err as { code?: string }).code === 'ER_NO_SUCH_TABLE'

/** Devuelve la plantilla guardada o, si no hay (o falta la migración REP-01), la de por defecto. */
export async function obtenerPlantilla(
  catalogo: CatalogoEgresos,
): Promise<{ plantilla: PlantillaCorteBalance; esPorDefecto: boolean; actualizadaEn: string | null }> {
  try {
    const rows = (await query('SELECT config, updated_at FROM reportes_plantillas WHERE clave = ? LIMIT 1', [
      CLAVE_PLANTILLA,
    ])) as { config: unknown; updated_at: Date | null }[]
    if (rows.length > 0) {
      const raw = typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config
      return {
        plantilla: validarPlantilla(raw),
        esPorDefecto: false,
        actualizadaEn: rows[0].updated_at ? new Date(rows[0].updated_at).toISOString() : null,
      }
    }
  } catch (err: unknown) {
    if (!esTablaInexistente(err)) throw err
  }
  return { plantilla: construirPlantillaPorDefecto(catalogo), esPorDefecto: true, actualizadaEn: null }
}

export async function guardarPlantilla(plantilla: PlantillaCorteBalance, userId: number): Promise<void> {
  try {
    await query(
      `INSERT INTO reportes_plantillas (clave, config, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE config = VALUES(config), updated_by = VALUES(updated_by)`,
      [CLAVE_PLANTILLA, JSON.stringify(plantilla), userId],
    )
  } catch (err: unknown) {
    if (esTablaInexistente(err)) {
      throw new Error('Falta aplicar la migración REP-01_create_reportes_plantillas.sql')
    }
    throw err
  }
}

/** Vuelve a la plantilla por defecto borrando la guardada. */
export async function restablecerPlantilla(): Promise<void> {
  try {
    await query('DELETE FROM reportes_plantillas WHERE clave = ?', [CLAVE_PLANTILLA])
  } catch (err: unknown) {
    if (!esTablaInexistente(err)) throw err
  }
}
