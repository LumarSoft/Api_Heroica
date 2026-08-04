import type { Workbook } from 'exceljs'

/**
 * ============================================================
 *  IMPORTACIÓN MASIVA DE EXTRACTOS BANCARIOS — CONTRATOS
 * ============================================================
 *
 * Cada banco exporta su extracto con un layout distinto. Un `BancoAdapter`
 * encapsula ese layout y devuelve siempre la misma estructura normalizada
 * (`FilaNormalizada[]`), de modo que el resto del pipeline —mapeo de conceptos,
 * agrupación, idempotencia e inserción en `movimientos`— es común a todos.
 *
 * Para agregar un banco nuevo:
 *   1. Crear `adapters/<banco>Adapter.ts` implementando `BancoAdapter`.
 *   2. Crear `adapters/<banco>Reglas.ts` con el mapeo de conceptos.
 *   3. Registrarlo en `registry.ts`.
 *   No hace falta tocar nada más del pipeline.
 * ============================================================
 */

/** Una fila del extracto, ya normalizada e independiente del banco de origen. */
export interface FilaNormalizada {
  /** Fecha del movimiento en formato YYYY-MM-DD. */
  fecha: string
  /** Código estable del concepto según el banco. Es la clave de mapeo. Ej: '917403'. */
  conceptoCodigo: string
  /** Texto del concepto según el banco. Informativo. Ej: 'NAVE - VENTA CON TARJETA'. */
  conceptoDescripcion: string
  /** Código del grupo de conceptos, si el banco lo provee. Ej: '000907'. */
  grupoCodigo: string | null
  /** Texto del grupo de conceptos. Ej: 'Transferencias'. */
  grupoDescripcion: string | null
  /** Descripción libre de la fila tal como la muestra el banco. */
  descripcionBanco: string
  /**
   * Monto SIGNADO: positivo = ingreso (crédito), negativo = egreso (débito).
   * Los bancos que usan columnas separadas de débito/crédito se unifican acá.
   */
  monto: number
  /** Identificador único de la operación según el banco, si lo trae. */
  operacionId: string | null
  /**
   * Nombre de la contraparte (beneficiario / ordenante) si el banco lo informa.
   * Insumo para autocompletar `proveedor_id` más adelante.
   */
  contraparte: string | null
  /** Estado del movimiento según el banco. Ej. Galicia: 'Imputado' | 'Pendiente'. */
  estadoBanco: string | null
  /** Saldo de la cuenta después de la operación, si el banco lo trae. */
  saldoBanco: number | null
  /** Número de comprobante, si el banco lo trae. */
  comprobante: string | null
  /** Fila cruda completa, para auditoría y para sobrevivir cambios de layout. */
  raw: Record<string, unknown>
}

export interface ResultadoParse {
  /** Clave del adapter que produjo el resultado. */
  adapter: string
  /** Cuenta detectada en el archivo o en su nombre. Ej: 'CC2131100751'. */
  cuentaDetectada: string | null
  moneda: 'ARS' | 'USD'
  filas: FilaNormalizada[]
  /** Avisos no fatales: filas salteadas, columnas faltantes, etc. */
  advertencias: string[]
}

export interface BancoAdapter {
  /** Clave estable, se persiste en `importaciones_bancarias.adapter`. */
  clave: string
  /** Nombre para mostrar en la UI. */
  nombre: string
  /**
   * Alias con los que se busca el banco en la tabla `bancos`. Permite que el
   * usuario no tenga que elegir el banco a mano: se detecta del archivo y de acá
   * sale a qué registro de `bancos` corresponde. La comparación es sin tildes ni
   * mayúsculas, por contención en ambos sentidos.
   */
  aliasesBanco: string[]
  /** Reglas fijas de mapeo de este banco, indexadas por código de concepto. */
  reglas: ReadonlyMap<string, ReglaConcepto>
  /**
   * Devuelve true si este adapter reconoce el archivo. Se usa para autodetectar
   * el banco cuando el usuario no lo elige explícitamente.
   */
  detectar(workbook: Workbook, nombreArchivo: string): boolean
  /** Parsea el archivo. Debe lanzar `ErrorDeFormato` si el layout no coincide. */
  parse(workbook: Workbook, nombreArchivo: string): ResultadoParse
}

/** Error de parseo con mensaje apto para mostrarle al usuario final. */
export class ErrorDeFormato extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeFormato'
  }
}

// ─────────────────────────────────────────────────────────────
//  Reglas de mapeo (fijas en código, una por banco)
// ─────────────────────────────────────────────────────────────

/**
 * A dónde va a parar un concepto del banco dentro de la caja.
 *
 * Los catálogos se referencian POR NOMBRE, no por ID: los IDs difieren entre
 * `heroica_oficial` y `heroica_prueba`, y una regla con un ID equivocado cargaría
 * movimientos mal clasificados sin avisar. Los nombres se resuelven contra la
 * base al importar, y si alguno no existe el preview falla con un mensaje claro.
 *
 * IMPORTANTE: dos conceptos con destino idéntico se consolidan en el MISMO
 * movimiento. Es la forma de netear (ej. las devoluciones Nave contra las
 * cobranzas Nave) y de agrupar familias enteras (ej. todos los impuestos y
 * comisiones en un único movimiento diario).
 */
export interface DestinoMapeo {
  /**
   * Texto que se escribe en `movimientos.concepto`. Si se omite se usa la
   * descripción: el cliente dejó de usar el concepto como campo propio y hoy
   * lo trata como sinónimo de la descripción.
   */
  concepto?: string
  /** Nombre en el catálogo `descripciones`. */
  descripcion: string
  /** Nombre en el catálogo `categorias`. */
  categoria: string
  /** Nombre en el catálogo `subcategorias`. */
  subcategoria: string
  /** Nombre en el catálogo `medios_pago`. */
  medioPago: string
  /** Nombre en el catálogo `proveedores`, si corresponde. */
  proveedor?: string
  /** 'diaria' = un movimiento por día · 'individual' = uno por fila del extracto. */
  agrupacion: 'diaria' | 'individual'
  /**
   * Tipo que espera el cliente para este concepto. Es solo una expectativa: el
   * tipo final lo define el signo del monto neto, y si no coinciden se emite una
   * advertencia en el preview.
   */
  tipoEsperado: 'ingreso' | 'egreso'
  /**
   * Invierte el signo que trae el banco antes de agrupar. Solo para conceptos
   * donde el extracto y la caja miran el movimiento desde lados opuestos.
   */
  invertirSigno?: boolean
}

export interface ReglaConcepto {
  /** Código del concepto según el banco. Ej. Galicia: '917403'. */
  codigo: string
  /** Nombre del concepto según el banco. Documental, para leer el archivo de reglas. */
  nombreBanco: string
  accion: 'importar' | 'ignorar'
  /** Por qué no se importa. Se muestra al usuario en el preview. Obligatorio si accion = 'ignorar'. */
  motivo?: string
  /** Obligatorio si accion = 'importar'. */
  destino?: DestinoMapeo
}

// ─────────────────────────────────────────────────────────────
//  Salida del pipeline (preview y confirmación)
// ─────────────────────────────────────────────────────────────

/** Un movimiento a crear en la caja banco (agregado de N filas del extracto). */
export interface MovimientoPropuesto {
  fecha: string
  concepto: string
  descripcion: string
  categoria: string
  subcategoria: string
  medioPago: string
  proveedor?: string
  /** Monto signado, ya sumado. */
  monto: number
  /** Derivado del signo del monto neto. */
  tipo: 'ingreso' | 'egreso'
  /** Cuántas filas del extracto se consolidaron en este movimiento. */
  cantidadFilas: number
  /** Códigos de concepto del banco que lo componen. Ej: ['917403','917761','907389']. */
  codigosBanco: string[]
  /** Hashes de las filas que lo componen, para vincularlas al insertar. */
  filaHashes: string[]
}

/** Concepto del banco que la regla manda no importar. Se informa al usuario. */
export interface ConceptoIgnorado {
  codigo: string
  nombreBanco: string
  motivo: string
  cantidadFilas: number
  montoTotal: number
}

/** Concepto del banco que no figura en las reglas del adapter. */
export interface ConceptoSinRegla {
  codigo: string
  conceptoDescripcion: string
  grupoDescripcion: string | null
  descripcionBanco: string
  contrapartes: string[]
  cantidadFilas: number
  montoTotal: number
  tipoSugerido: 'ingreso' | 'egreso'
}

/**
 * Desglose del neto del archivo. La suma de las cuatro partes tiene que dar
 * `netoArchivo`; es la forma de mostrarle al usuario, sin ambigüedad, cuánta
 * plata del extracto NO va a llegar a la caja y por qué.
 */
export interface DesgloseNeto {
  /** Neto de todas las filas del archivo. */
  netoArchivo: number
  /** Lo que efectivamente se va a cargar. */
  netoImportado: number
  /** Lo que las reglas descartan a propósito. */
  netoIgnorado: number
  /** Lo que ya se había importado en una corrida anterior. */
  netoYaImportado: number
  /** Lo que no se puede cargar porque falta la regla. */
  netoSinRegla: number
}

export interface PreviewImportacion {
  adapter: string
  bancoId: number
  sucursalId: number
  cuentaDetectada: string | null
  moneda: 'ARS' | 'USD'
  archivoHash: string
  fechaDesde: string | null
  fechaHasta: string | null

  filasTotales: number
  filasNuevas: number
  filasOmitidas: number
  filasIgnoradas: number

  movimientos: MovimientoPropuesto[]
  conceptosIgnorados: ConceptoIgnorado[]
  conceptosSinRegla: ConceptoSinRegla[]
  advertencias: string[]

  desglose: DesgloseNeto

  /**
   * Control de integridad del PARSEO (no del negocio): compara el neto de todas
   * las filas leídas contra la variación de saldo que declara el propio banco.
   * Si no cuadra, el adapter leyó mal alguna columna. Es independiente de qué
   * conceptos se ignoren, así que sigue siendo útil aunque se descarte el 60%
   * del volumen.
   */
  controlSaldo: { esperado: number; calculado: number; cuadra: boolean } | null
}
