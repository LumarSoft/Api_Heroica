import { query } from '../../config/database'
import type { FiltroDashboard } from './hioposClient'
import type { ItemCrudo } from './types'

/**
 * Mapeo entre las columnas del dashboard de exportación de HiOffice y los datos que
 * usa el módulo de ventas. Las columnas las elige quien arma el dashboard (y pueden
 * cambiar), así que el mapeo se detecta solo por nombre y se puede corregir desde la
 * pantalla de Integraciones. Se guarda en `ventas_hiopos_config`.
 */

export type CampoVenta =
  | 'documentoGuid'
  | 'serie'
  | 'numero'
  | 'tipoDocumento'
  | 'fecha'
  | 'hora'
  | 'fechaModificado'
  | 'localCodigo'
  | 'localNombre'
  | 'productoCodigo'
  | 'productoNombre'
  | 'categoria'
  | 'cantidad'
  | 'precioUnitario'
  | 'importe'
  | 'descuento'
  | 'medioPago'
  | 'canal'
  | 'vendedor'
  | 'caja'
  | 'estado'

export interface DefinicionCampo {
  campo: CampoVenta
  etiqueta: string
  ayuda: string
  requerido: boolean
  /** Nombres de columna habituales en HiOffice (se comparan sin tildes, espacios ni mayúsculas). */
  sinonimos: string[]
}

export const CAMPOS_VENTA: DefinicionCampo[] = [
  {
    campo: 'fecha',
    etiqueta: 'Fecha del documento',
    ayuda: 'Día contable del ticket o factura.',
    requerido: true,
    sinonimos: ['fecha', 'fechadocumento', 'fechadoc', 'fechaventa', 'fechaticket', 'fechafactura', 'date', 'dia'],
  },
  {
    campo: 'importe',
    etiqueta: 'Importe de la línea',
    ayuda: 'Total de la línea con impuestos y descuentos aplicados.',
    requerido: true,
    sinonimos: [
      'importe',
      'total',
      'totallinea',
      'importelinea',
      'importeneto',
      'totalneto',
      'nettotal',
      'totaliva',
      'totalconiva',
      'importetotal',
      'neto',
      'venta',
      'ventas',
      'amount',
    ],
  },
  {
    campo: 'numero',
    etiqueta: 'Número de documento',
    ayuda: 'Número del ticket/factura (o "SU DOC").',
    requerido: false,
    sinonimos: [
      'numero',
      'numerodocumento',
      'numdocumento',
      'numdoc',
      'ndoc',
      'nro',
      'nrodocumento',
      'sudoc',
      'ticket',
      'numticket',
      'number',
      'documento',
    ],
  },
  {
    campo: 'serie',
    etiqueta: 'Serie',
    ayuda: 'Serie o punto de venta del documento.',
    requerido: false,
    sinonimos: ['serie', 'seriedocumento', 'seriedoc', 'serie_doc', 'puntodeventa', 'puntoventa'],
  },
  {
    campo: 'documentoGuid',
    etiqueta: 'GUID del documento',
    ayuda: 'Identificador interno estable de HiOffice. Evita duplicados aunque se renumere.',
    requerido: false,
    sinonimos: ['guid', 'guiddocumento', 'docguid', 'guiddoc', 'uuid', 'iddocumento'],
  },
  {
    campo: 'tipoDocumento',
    etiqueta: 'Tipo de documento',
    ayuda: 'Ticket, factura, abono…',
    requerido: false,
    sinonimos: ['tipodocumento', 'tipodoc', 'tipo', 'clasedocumento', 'tipocomprobante'],
  },
  {
    campo: 'hora',
    etiqueta: 'Hora',
    ayuda: 'Hora del ticket (para franjas horarias y mapa de calor).',
    requerido: false,
    sinonimos: ['hora', 'horadocumento', 'horaventa', 'horaticket', 'time', 'fechahora', 'fechayhora'],
  },
  {
    campo: 'fechaModificado',
    etiqueta: 'Fecha modificado',
    ayuda: 'Cuándo se creó o modificó el registro en HiOffice. Permite traer solo lo nuevo.',
    requerido: false,
    sinonimos: [
      'fechamodificado',
      'fechamodificacion',
      'updateversion',
      'updateversionart',
      'modificado',
      'ultimamodificacion',
    ],
  },
  {
    campo: 'localCodigo',
    etiqueta: 'Código de almacén / tienda',
    ayuda: 'Identifica el local; se vincula a una sucursal de Heroica.',
    requerido: false,
    sinonimos: [
      'codalmacen',
      'codigoalmacen',
      'almacencodigo',
      'codtienda',
      'codigotienda',
      'codlocal',
      'codigolocal',
      'idalmacen',
      'idtienda',
    ],
  },
  {
    campo: 'localNombre',
    etiqueta: 'Almacén / tienda',
    ayuda: 'Nombre del local en HiOffice.',
    requerido: false,
    sinonimos: [
      'almacen',
      'nombrealmacen',
      'tienda',
      'nombretienda',
      'local',
      'nombrelocal',
      'sucursal',
      'establecimiento',
      'shop',
    ],
  },
  {
    campo: 'productoCodigo',
    etiqueta: 'Código de artículo',
    ayuda: 'Referencia o código del producto.',
    requerido: false,
    sinonimos: [
      'codarticulo',
      'codigoarticulo',
      'referencia',
      'ref',
      'sku',
      'codart',
      'idarticulo',
      'codigoproducto',
      'codproducto',
    ],
  },
  {
    campo: 'productoNombre',
    etiqueta: 'Artículo',
    ayuda: 'Nombre del producto vendido.',
    requerido: false,
    sinonimos: [
      'articulo',
      'descripcion',
      'descripcionarticulo',
      'nombrearticulo',
      'producto',
      'nombreproducto',
      'article',
      'product',
    ],
  },
  {
    campo: 'categoria',
    etiqueta: 'Familia / categoría',
    ayuda: 'Agrupa productos en los reportes.',
    requerido: false,
    sinonimos: ['familia', 'nombrefamilia', 'categoria', 'departamento', 'seccion', 'subfamilia', 'grupo'],
  },
  {
    campo: 'cantidad',
    etiqueta: 'Unidades',
    ayuda: 'Cantidad vendida en la línea.',
    requerido: false,
    sinonimos: ['unidades', 'cantidad', 'uds', 'unid', 'qty', 'quantity'],
  },
  {
    campo: 'precioUnitario',
    etiqueta: 'Precio unitario',
    ayuda: 'Precio por unidad.',
    requerido: false,
    sinonimos: ['precio', 'preciounitario', 'pvp', 'precioventa', 'preciouni', 'unitprice'],
  },
  {
    campo: 'descuento',
    etiqueta: 'Descuento',
    ayuda: 'Importe descontado en la línea (positivo).',
    requerido: false,
    sinonimos: ['descuento', 'importedescuento', 'dto', 'importedto', 'descuentolinea', 'totaldescuento'],
  },
  {
    campo: 'medioPago',
    etiqueta: 'Forma de pago',
    ayuda: 'Efectivo, tarjeta, Mercado Pago…',
    requerido: false,
    sinonimos: [
      'formapago',
      'formadepago',
      'formaspago',
      'mediopago',
      'mediodepago',
      'formapag',
      'pago',
      'paymentmethod',
    ],
  },
  {
    campo: 'canal',
    etiqueta: 'Canal / tipo de venta',
    ayuda: 'Salón, mostrador, delivery, apps…',
    requerido: false,
    sinonimos: ['canal', 'tipoventa', 'tipodeventa', 'origen', 'sala', 'canalventa', 'modalidad'],
  },
  {
    campo: 'vendedor',
    etiqueta: 'Vendedor',
    ayuda: 'Quién hizo la venta (para el análisis por vendedor).',
    requerido: false,
    sinonimos: ['vendedor', 'nombrevendedor', 'empleado', 'camarero', 'cajero', 'usuario', 'atendio'],
  },
  {
    campo: 'caja',
    etiqueta: 'Caja / terminal',
    ayuda: 'Caja o terminal donde se cobró.',
    requerido: false,
    sinonimos: ['caja', 'terminal', 'tpv', 'numcaja', 'codcaja', 'nombrecaja'],
  },
  {
    campo: 'estado',
    etiqueta: 'Estado',
    ayuda: 'Si indica "anulado", el documento no suma.',
    requerido: false,
    sinonimos: ['estado', 'anulado', 'status', 'situacion'],
  },
]

export type MapeoColumnas = Partial<Record<CampoVenta, string>>

export interface ColumnaDetectada {
  nombre: string
  ejemplos: string[]
}

export interface ConfigHiopos {
  exportationId: string | null
  /** De dónde sale el exportationId: la pantalla de Integraciones o la variable de entorno. */
  exportationIdOrigen: 'pantalla' | 'entorno' | null
  attrFechaModificado: number | null
  mapeo: MapeoColumnas
  columnasDetectadas: ColumnaDetectada[]
  filtrosDashboard: FiltroDashboard[]
  diasPorTramo: number
  watermarkMs: number | null
  verificadoAt: string | null
  ultimoError: string | null
}

export function claveColumna(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Mapeo automático por nombre: primero coincidencia exacta, después parcial. */
export function detectarMapeo(columnas: string[]): MapeoColumnas {
  const mapeo: MapeoColumnas = {}
  const usadas = new Set<string>()
  const claves = columnas.map(c => ({ original: c, clave: claveColumna(c) }))

  for (const pasada of ['exacta', 'parcial'] as const) {
    for (const def of CAMPOS_VENTA) {
      if (mapeo[def.campo]) continue
      const candidata = claves.find(({ original, clave }) => {
        if (usadas.has(original)) return false
        return def.sinonimos.some(s =>
          pasada === 'exacta' ? clave === s : s.length >= 5 && (clave.startsWith(s) || clave.endsWith(s)),
        )
      })
      if (candidata) {
        mapeo[def.campo] = candidata.original
        usadas.add(candidata.original)
      }
    }
  }
  return mapeo
}

/** Columnas presentes y hasta 3 valores de ejemplo (para elegir el mapeo en pantalla). */
export function detectarColumnas(filas: ItemCrudo[]): ColumnaDetectada[] {
  const columnas = new Map<string, Set<string>>()
  for (const fila of filas.slice(0, 200)) {
    for (const [nombre, valor] of Object.entries(fila)) {
      if (!columnas.has(nombre)) columnas.set(nombre, new Set())
      const ejemplos = columnas.get(nombre) as Set<string>
      if (ejemplos.size < 3 && valor !== null && valor !== undefined && String(valor).trim() !== '') {
        ejemplos.add(String(valor).slice(0, 60))
      }
    }
  }
  return [...columnas.entries()].map(([nombre, ejemplos]) => ({ nombre, ejemplos: [...ejemplos] }))
}

/** Qué falta para poder importar con este mapeo. */
export function validarMapeo(mapeo: MapeoColumnas): string[] {
  const faltantes: string[] = []
  if (!mapeo.fecha) faltantes.push('Falta indicar la columna de fecha del documento')
  if (!mapeo.importe && !(mapeo.cantidad && mapeo.precioUnitario)) {
    faltantes.push('Falta indicar la columna de importe (o cantidad y precio unitario)')
  }
  if (!mapeo.documentoGuid && !mapeo.numero) {
    faltantes.push('Falta indicar el número o el GUID del documento (sin eso no se pueden agrupar tickets)')
  }
  return faltantes
}

// ─── Configuración persistida ─────────────────────────────────────────────────

function parsearJson<T>(valor: unknown, porDefecto: T): T {
  if (valor === null || valor === undefined) return porDefecto
  if (typeof valor === 'object') return valor as T
  try {
    return JSON.parse(String(valor)) as T
  } catch {
    return porDefecto
  }
}

export async function leerConfigHiopos(): Promise<ConfigHiopos> {
  const [fila] = (await query('SELECT * FROM ventas_hiopos_config WHERE id = 1')) as Array<Record<string, unknown>>
  const desdePantalla =
    typeof fila?.exportation_id === 'string' && fila.exportation_id.trim() ? fila.exportation_id.trim() : null
  const desdeEntorno = process.env.HIOPOS_EXPORTATION_ID?.trim() || null
  const dias = Number(fila?.dias_por_tramo)
  return {
    exportationId: desdePantalla ?? desdeEntorno,
    exportationIdOrigen: desdePantalla ? 'pantalla' : desdeEntorno ? 'entorno' : null,
    attrFechaModificado:
      fila?.attr_fecha_modificado === null || fila?.attr_fecha_modificado === undefined
        ? null
        : Number(fila.attr_fecha_modificado),
    mapeo: parsearJson<MapeoColumnas>(fila?.mapeo_columnas, {}),
    columnasDetectadas: parsearJson<ColumnaDetectada[]>(fila?.columnas_detectadas, []),
    filtrosDashboard: parsearJson<FiltroDashboard[]>(fila?.filtros_dashboard, []),
    diasPorTramo: Number.isFinite(dias) && dias >= 1 && dias <= 31 ? dias : 5,
    watermarkMs: fila?.watermark_ms === null || fila?.watermark_ms === undefined ? null : Number(fila.watermark_ms),
    verificadoAt: fila?.verificado_at ? new Date(String(fila.verificado_at)).toISOString() : null,
    ultimoError: (fila?.ultimo_error as string | null) ?? null,
  }
}

type CambiosConfig = Partial<{
  exportation_id: string | null
  attr_fecha_modificado: number | null
  mapeo_columnas: MapeoColumnas
  columnas_detectadas: ColumnaDetectada[]
  filtros_dashboard: FiltroDashboard[]
  dias_por_tramo: number
  watermark_ms: number | null
  verificado_at: Date | null
  ultimo_error: string | null
  updated_by: number | null
}>

const COLUMNAS_JSON = new Set(['mapeo_columnas', 'columnas_detectadas', 'filtros_dashboard'])

export async function guardarConfigHiopos(cambios: CambiosConfig): Promise<void> {
  const entradas = Object.entries(cambios).filter(([, v]) => v !== undefined)
  if (entradas.length === 0) return
  await query('INSERT IGNORE INTO ventas_hiopos_config (id) VALUES (1)')
  await query(
    `UPDATE ventas_hiopos_config SET ${entradas.map(([k]) => `${k} = ?`).join(', ')} WHERE id = 1`,
    entradas.map(([k, v]) => (COLUMNAS_JSON.has(k) ? JSON.stringify(v) : v)),
  )
}

/**
 * Elige el filtro de "Fecha Modificado": el único Datetime BETWEEN de la plantilla.
 * Si hay más de uno no se adivina (se elige en pantalla).
 */
export function detectarFiltroFechaModificado(filtros: FiltroDashboard[]): number | null {
  const candidatos = filtros.filter(
    f => String(f.type).toLowerCase() === 'datetime' && String(f.arithmeticOperator).toUpperCase() === 'BETWEEN',
  )
  return candidatos.length === 1 ? candidatos[0].attributeId : null
}
