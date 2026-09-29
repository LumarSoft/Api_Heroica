/**
 * ============================================================
 *  MÓDULO DE VENTAS — CONTRATOS
 * ============================================================
 *
 * Cada punto de venta (Bistrosoft, Hiopos) expone sus transacciones con un
 * formato propio. Un conector trae los ítems crudos y un normalizador los
 * convierte a `LineaVentaNormalizada`, de modo que la sincronización, el panel
 * y los arqueos trabajen siempre con la misma estructura.
 * ============================================================
 */

export type FuenteVentas = 'bistrosoft' | 'hiopos'

/**
 * producto: ítem vendido · pago: encabezado del ticket (total + medio de pago) ·
 * descuento: importe negativo del ticket · caja: apertura/retiro/cierre de caja ·
 * otro: componentes de combos y líneas sin clasificar (no suman).
 */
export type TipoLineaVenta = 'producto' | 'pago' | 'descuento' | 'caja' | 'otro'

export type OrigenSincronizacion = 'automatica' | 'manual'

export type EstadoSincronizacion = 'en_curso' | 'exitosa' | 'con_observaciones' | 'fallida'

/** Ítem tal como llega de la API externa. */
export type ItemCrudo = Record<string, unknown>

/** Una línea de venta ya normalizada e independiente de la fuente. */
export interface LineaVentaNormalizada {
  /** Código del local/comercio en la fuente (shopCode). */
  localCodigo: string | null
  localNombre: string | null
  transaccionId: string
  /**
   * YYYY-MM-DD HH:mm:ss, hora local Argentina. El día operativo NO sale de acá: es el
   * día que se le consultó a la fuente (una venta de la 01:30 pertenece al día anterior).
   */
  fechaHora: string | null
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
  estadoOrigen: string | null
  anulada: boolean
  raw: ItemCrudo
}

export type ResultadoNormalizacion =
  | { ok: true; linea: LineaVentaNormalizada }
  | { ok: false; motivo: string; raw: ItemCrudo }
