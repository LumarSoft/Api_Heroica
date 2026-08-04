import type { ReglaConcepto } from '../types'

/**
 * ============================================================
 *  REGLAS DE MAPEO — BANCO GALICIA
 * ============================================================
 *
 * Definidas sobre el extracto de junio 2026 (4.684 filas, 22 conceptos) más el
 * echeq visto en el de julio. Son FIJAS: no hay ABM de reglas, se versionan con
 * el código.
 *
 * Los catálogos se referencian POR NOMBRE y se resuelven contra la base al
 * importar (ver `catalogoResolver.ts`). Todos los nombres de acá abajo existen
 * hoy en producción — no se crea ninguno. Si alguno desaparece o se renombra,
 * el preview falla con la lista exacta antes de tocar la caja.
 *
 * ── Cómo agrupa el importador ──────────────────────────────────────────────
 * Los movimientos se consolidan por (fecha + destino), donde "destino" es la
 * combinación descripción/categoría/subcategoría/medio de pago. Dos códigos
 * distintos con el MISMO destino terminan en un único movimiento. Acá se usa
 * para las cobranzas Nave: tarjeta, transferencia y devoluciones comparten
 * destino, así que cada día se crea un solo movimiento por el neto cobrado.
 *
 * ── OJO CON 917761 ─────────────────────────────────────────────────────────
 * Galicia lo llama "DEVOLUCION CON PAGO CON TRANSFERENCIA", pero NO es una
 * devolución. Es un crédito de ~27M mensuales (1.214 filas en junio) cuya
 * descripción real en el extracto es "NAVE PAGO CON TRANSFERENCIA": es el
 * segundo medio de cobro de Nave, hermano de 917403. La devolución de verdad es
 * 907389 ("NAVE DEVOLUCIÓN", 2 filas, −44.220,76). Restar 917761 de 917403
 * daría −382.255 en vez de +53.733.381 — 54 millones de error. Si alguien
 * vuelve a tocar esto, que lea este párrafo primero.
 */

// ── Destinos reutilizados ────────────────────────────────────────────────────
// Definirlos una sola vez garantiza que los conceptos que tienen que consolidar
// compartan destino carácter por carácter.

/**
 * Cobranzas Nave. Los tres códigos caen acá y se netean en un movimiento diario.
 *
 * Subcategoría "Transferencia" por decisión del cliente: no se pueden crear
 * subcategorías nuevas y es la que mejor representa el flujo, aunque una parte
 * del volumen entre por tarjeta.
 */
const COBRANZA_NAVE = {
  descripcion: 'Nave',
  categoria: 'VENTA LOCAL',
  subcategoria: 'Transferencia',
  medioPago: 'Transferencia',
} as const

const COMISION_BANCARIA = {
  categoria: 'FINANCIERO',
  subcategoria: 'Comisiones bancarias',
  medioPago: 'Débito Automático',
} as const

const IMPUESTO_IIBB = {
  categoria: 'IMPOSITIVO',
  subcategoria: 'IIBB/CM',
  medioPago: 'Débito Automático',
} as const

/**
 * Impuesto al cheque (Ley 25413). Débitos y créditos comparten destino para que
 * queden en un único movimiento diario.
 *
 * OJO con la descripción: en la base hay DOS descripciones que normalizan igual,
 * la id 64 (con un tabulador adelante) y la id 81. El resolutor desempata por
 * coincidencia exacta de texto, así que este string tiene que quedar tal cual
 * está escrita la id 81.
 */
const IMPUESTO_LEY_25413 = {
  descripcion: 'IMP.LEY 25413',
  categoria: 'IMPOSITIVO',
  subcategoria: 'IIBB/CM',
  medioPago: 'Débito Automático',
} as const

const IMPUESTO_IVA = {
  categoria: 'IMPOSITIVO',
  subcategoria: 'IVA',
  medioPago: 'Débito Automático',
} as const

/** Motivo estándar de los conceptos que el cliente decidió no importar. */
const YA_PROYECTADO = 'Ya se carga a mano como pago proyectado en la caja. Importarlo lo duplicaría.'

export const REGLAS_GALICIA: ReglaConcepto[] = [
  // ══ COBRANZAS NAVE ════════════════════════════════════════════════════════
  // Los tres códigos comparten destino: un único movimiento diario por el neto.
  {
    codigo: '917403',
    nombreBanco: 'NAVE - VENTA CON TARJETA',
    accion: 'importar',
    destino: { ...COBRANZA_NAVE, agrupacion: 'diaria', tipoEsperado: 'ingreso' },
  },
  {
    codigo: '917761',
    nombreBanco: 'DEVOLUCION CON PAGO CON TRANSFERENCIA (en realidad: NAVE PAGO CON TRANSFERENCIA)',
    accion: 'importar',
    destino: { ...COBRANZA_NAVE, agrupacion: 'diaria', tipoEsperado: 'ingreso' },
  },
  {
    codigo: '907389',
    nombreBanco: 'COMPRA CON TRANSFERENCIA (NAVE DEVOLUCIÓN)',
    accion: 'importar',
    // Viene como débito, así que resta sola del total del día. No lleva
    // invertirSigno: el signo del banco ya es el correcto.
    destino: { ...COBRANZA_NAVE, agrupacion: 'diaria', tipoEsperado: 'egreso' },
  },

  // ══ IMPUESTOS ═════════════════════════════════════════════════════════════
  // Cada uno mantiene su descripción propia (las que ya existen con el nombre
  // del banco), así que generan movimientos diarios separados.
  {
    codigo: '907173',
    nombreBanco: 'ING. BRUTOS S/ CRED (retención SIRCREB, una por cada cobranza Nave)',
    accion: 'importar',
    destino: {
      ...IMPUESTO_IIBB,
      descripcion: 'Ing. Brutos S/ Cred',
      agrupacion: 'diaria',
      tipoEsperado: 'egreso',
    },
  },
  // Los dos tramos de la Ley 25413 (débitos y créditos) comparten la descripción
  // `IMP.LEY 25413`, así que se consolidan en UN movimiento diario en vez de dos.
  // Son montos chicos y de la misma naturaleza; separarlos generaba 42 movimientos
  // mensuales por ~440 mil pesos en total.
  //
  // NOTA: la Ley 25413 es el impuesto al cheque, no ingresos brutos. Va a IIBB/CM
  // porque no existe una subcategoría específica y no se pueden crear. Si más
  // adelante se crea "Impuesto al cheque", cambiar en IMPUESTO_LEY_25413.
  {
    codigo: '907176',
    nombreBanco: 'IMP. DEB. LEY 25413',
    accion: 'importar',
    destino: { ...IMPUESTO_LEY_25413, agrupacion: 'diaria', tipoEsperado: 'egreso' },
  },
  {
    codigo: '907376',
    nombreBanco: 'IMP. CRE. LEY 25413',
    accion: 'importar',
    destino: { ...IMPUESTO_LEY_25413, agrupacion: 'diaria', tipoEsperado: 'egreso' },
  },
  {
    codigo: '907171',
    nombreBanco: 'IVA',
    accion: 'importar',
    destino: { ...IMPUESTO_IVA, descripcion: 'IVA', agrupacion: 'diaria', tipoEsperado: 'egreso' },
  },
  {
    codigo: '907172',
    nombreBanco: 'PERCEP. IVA',
    accion: 'importar',
    destino: { ...IMPUESTO_IVA, descripcion: 'PERCEP. IVA', agrupacion: 'diaria', tipoEsperado: 'egreso' },
  },

  // ══ COMISIONES BANCARIAS ══════════════════════════════════════════════════
  {
    codigo: '907138',
    nombreBanco: 'COM. GESTION TRANSF.FDOS ENTRE BCOS',
    accion: 'importar',
    destino: {
      ...COMISION_BANCARIA,
      descripcion: 'Com. Gestion Transf.fdos Entre Bcos',
      agrupacion: 'diaria',
      tipoEsperado: 'egreso',
    },
  },
  {
    codigo: '907394',
    nombreBanco: 'COMISION SERVICIO DE CUENTA',
    accion: 'importar',
    destino: {
      ...COMISION_BANCARIA,
      descripcion: 'COMISION SERVICIO DE CUENTA',
      agrupacion: 'diaria',
      tipoEsperado: 'egreso',
    },
  },

  // ══ PAGOS ═════════════════════════════════════════════════════════════════
  {
    codigo: '907154',
    nombreBanco: 'PAGO VISA EMPRESA',
    accion: 'importar',
    destino: {
      descripcion: 'PAGO VISA EMPRESA',
      categoria: 'ADMINISTRACION VARIABLE',
      subcategoria: 'Administrativo',
      // El cliente eligió "Tarjeta de débito" en la planilla. La leyenda del
      // banco dice "D.A. AL VTO BUSINESS" (débito automático al vencimiento),
      // así que puede corresponder Débito Automático. Se respeta lo que pidió.
      medioPago: 'Tarjeta de Débito',
      agrupacion: 'individual',
      tipoEsperado: 'egreso',
    },
  },
  {
    codigo: '907213',
    nombreBanco: 'DEB. AUTOM. DE SERV.',
    accion: 'importar',
    // La leyenda del banco dice "SAN CRISTOBAL SG" — aseguradora.
    destino: {
      descripcion: 'DEB. AUTOM. DE SERV.',
      categoria: 'ADMINISTRACION VARIABLE',
      subcategoria: 'Seguros',
      medioPago: 'Débito Automático',
      agrupacion: 'individual',
      tipoEsperado: 'egreso',
    },
  },

  // ══ IGNORADOS ═════════════════════════════════════════════════════════════
  // Se leen, se cuentan y se muestran en el preview, pero no generan movimiento.
  // Son ~55M mensuales: la caja importada NO reconcilia contra el saldo del banco.
  { codigo: '907232', nombreBanco: 'TRF INMED PROVEED', accion: 'ignorar', motivo: YA_PROYECTADO },
  { codigo: '907269', nombreBanco: 'TRF INMED PROVEED', accion: 'ignorar', motivo: YA_PROYECTADO },
  { codigo: '907268', nombreBanco: 'TRANSF INMED CP', accion: 'ignorar', motivo: YA_PROYECTADO },
  { codigo: '907179', nombreBanco: 'TRANSF. A TERCEROS', accion: 'ignorar', motivo: YA_PROYECTADO },
  { codigo: '907255', nombreBanco: 'TRANSF. AFIP', accion: 'ignorar', motivo: YA_PROYECTADO },
  {
    codigo: '907139',
    nombreBanco: 'SERVICIO ACREDITAMIENTO DE HABERES',
    accion: 'ignorar',
    motivo: 'Sueldos: ya se cargan a mano como pago proyectado.',
  },
  {
    codigo: '907242',
    nombreBanco: 'CUOTA DE PRESTAMO',
    accion: 'ignorar',
    motivo: 'Cuota de préstamo: ya se carga a mano como pago proyectado.',
  },
  {
    codigo: '907365',
    nombreBanco: 'ECHEQ 48 HS.',
    accion: 'ignorar',
    motivo: 'Echeq: ya se carga a mano como pago proyectado.',
  },
  {
    codigo: '917138',
    nombreBanco: 'RESCATE FIMA',
    accion: 'ignorar',
    motivo: 'Movimiento entre instrumentos propios (fondo común de inversión), no es ingreso operativo.',
  },
  {
    codigo: '907237',
    nombreBanco: 'SUSCRIPCION FIMA',
    accion: 'ignorar',
    motivo: 'Movimiento entre instrumentos propios (fondo común de inversión), no es egreso operativo.',
  },
  {
    codigo: '917312',
    nombreBanco: 'TRANSF. CTAS PROPIAS',
    accion: 'ignorar',
    motivo: 'Transferencia entre cuentas propias / empresa vinculada.',
  },
]

/** Índice por código, para lookup O(1) durante la importación. */
export const REGLAS_GALICIA_POR_CODIGO: ReadonlyMap<string, ReglaConcepto> = new Map(
  REGLAS_GALICIA.map(r => [r.codigo, r]),
)
