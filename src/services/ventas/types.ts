/**
 * ============================================================
 *  MÓDULO DE VENTAS — CONTRATOS
 * ============================================================
 *
 * Las ventas llegan desde Hiopos (HiOffice) a través del Bridge de ICG: un dashboard
 * de exportación configurado en HiOffice devuelve filas (una por línea de ticket) con
 * las columnas que eligió quien lo armó. El mapeo de columnas (ver hioposMapeo.ts)
 * dice qué columna es cada dato y el normalizador las convierte a
 * `LineaVentaNormalizada`, de modo que la sincronización, el panel y los reportes
 * trabajen siempre con la misma estructura.
 * ============================================================
 */

export type FuenteVentas = 'hiopos'

/**
 * producto: ítem vendido · pago: encabezado del ticket (total + medio de pago) ·
 * descuento: importe negativo del ticket · caja: apertura/retiro/cierre de caja ·
 * otro: líneas sin clasificar (no suman).
 */
export type TipoLineaVenta = 'producto' | 'pago' | 'descuento' | 'caja' | 'otro'

export type OrigenSincronizacion = 'automatica' | 'manual'

/** rango = se reemplazan días completos · cambios = documentos modificados desde la marca de agua. */
export type TipoSincronizacion = 'rango' | 'cambios'

export type EstadoSincronizacion = 'en_curso' | 'exitosa' | 'con_observaciones' | 'fallida'

/** Fila tal como llega del export (ya decodificada y con los números saneados). */
export type ItemCrudo = Record<string, unknown>

/** Una línea de venta ya normalizada e independiente de cómo se armó el dashboard. */
export interface LineaVentaNormalizada {
  /** Código (o nombre, si no hay código) del almacén/tienda en HiOffice. */
  localCodigo: string | null
  localNombre: string | null
  /** Clave estable del documento: GUID de HiOffice o serie-número. */
  transaccionId: string
  /** Serie-número tal como lo ve el cliente (ticket/factura). */
  documento: string | null
  tipoDocumento: string | null
  /** Día del documento (fecha contable), YYYY-MM-DD. */
  fecha: string
  /** YYYY-MM-DD HH:mm:ss, hora local Argentina. */
  fechaHora: string | null
  /** Epoch ms de la última modificación en HiOffice (marca de agua), si viene en el export. */
  modificadoMs: number | null
  tipoLinea: TipoLineaVenta
  productoCodigo: string | null
  productoNombre: string | null
  categoria: string | null
  cantidad: number
  precioUnitario: number | null
  importe: number
  descuento: number
  medioPago: string | null
  canal: string | null
  vendedor: string | null
  caja: string | null
  estadoOrigen: string | null
  anulada: boolean
  raw: ItemCrudo
}

export type ResultadoNormalizacion =
  | { ok: true; linea: LineaVentaNormalizada }
  | { ok: false; motivo: string; raw: ItemCrudo }
