import type { ItemCrudo, LineaVentaNormalizada, ResultadoNormalizacion, TipoLineaVenta } from './types'

/**
 * Normaliza los ítems de `TransactionDetailReport` de Bistrosoft.
 *
 * Formato validado con datos reales (2026-09-28). Cada ítem es una línea y
 * `transactionType` dice qué es:
 *   - "Comanda" / "Venta"        → encabezado del ticket: total (`amount`) y medio de pago.
 *                                  `status` VOID / VOID_NT = anulado.
 *   - "Comanda (Multipago)" /    → pago dividido: un encabezado por cada parte, con su
 *     "Venta (Multipago)"          importe y medio de pago (la suma da el total del ticket).
 *   - "- ITEM" / "- COMBO"       → producto vendido (`amount` = total de la línea).
 *   - "- COMBO ITEM"             → componente de un combo, importe 0 (no suma unidades).
 *   - "- ITEM DESCUENTO"         → descuento, importe negativo.
 *   - "CAJA (…)"                 → apertura, retiro, depósito, ajuste y cierre de caja
 *                                  (se guardan para los arqueos; no son ventas).
 * Un ticket anulado trae sus líneas originales + las mismas en negativo (neto 0), y solo
 * el encabezado lleva el status VOID: la anulación se propaga a todo el ticket.
 * Los ítems de un mismo ticket comparten `uuid`. En cada ticket no anulado, la suma de
 * ITEM + COMBO + DESCUENTO coincide con la suma de los encabezados.
 */

type Tipo = 'encabezado' | 'producto' | 'componente' | 'descuento' | 'caja' | 'otro'

/** Campos con datos personales de clientes que no hace falta guardar. */
const CAMPOS_PRIVADOS = ['client']

const CANALES: Record<string, string> = {
  MOSTRADOR: 'Mostrador',
  SALON: 'Salón',
  'PEDIDOS YA': 'Pedidos Ya',
  RAPPI: 'Rappi',
  DELIVERY: 'Delivery',
  'TAKE AWAY': 'Take away',
}

function clasificar(transactionType: string): Tipo {
  const t = transactionType.trim().toUpperCase()
  // "Comanda", "Venta" y sus variantes "(Multipago)": una línea por cada parte del pago.
  if (t.startsWith('COMANDA') || t.startsWith('VENTA')) return 'encabezado'
  if (t === '- ITEM' || t === '- COMBO') return 'producto'
  if (t === '- COMBO ITEM') return 'componente'
  if (t.includes('DESCUENTO')) return 'descuento'
  if (t.startsWith('CAJA')) return 'caja'
  return 'otro'
}

const TIPO_LINEA: Record<Tipo, TipoLineaVenta> = {
  encabezado: 'pago',
  producto: 'producto',
  componente: 'otro',
  descuento: 'descuento',
  caja: 'caja',
  otro: 'otro',
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor)
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio && limpio !== '-' ? limpio : null
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor === 'string' && valor.trim()) {
    const n = Number(valor)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** `timestamp` viene sin zona ("2026-09-20T07:58:49"): ya es hora local Argentina. */
function fechaHora(item: ItemCrudo): string | null {
  const ts = texto(item.timestamp)
  const m = ts?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/)
  if (m) return `${m[1]} ${m[2]}`
  // Respaldo: date "20-09-2026" + hour "07:58:49"
  const d = texto(item.date)?.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  const h = texto(item.hour)?.match(/^\d{2}:\d{2}:\d{2}$/)
  return d ? `${d[3]}-${d[2]}-${d[1]} ${h ? h[0] : '00:00:00'}` : null
}

function canal(valor: unknown): string | null {
  const t = texto(valor)
  if (!t) return null
  const clave = t.toUpperCase().replace('Ó', 'O')
  return CANALES[clave] ?? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

function claveTicket(item: ItemCrudo): string | null {
  const uuid = texto(item.uuid)
  if (uuid) return uuid
  const ticket = numero(item.ticketNumber)
  return ticket ? `${texto(item.shopCode) ?? 'sin-local'}#${ticket}` : null
}

function sinDatosPrivados(item: ItemCrudo): ItemCrudo {
  const copia = { ...item }
  for (const campo of CAMPOS_PRIVADOS) delete copia[campo]
  return copia
}

/**
 * Normaliza TODOS los ítems de un día juntos: la anulación de un ticket está solo en su
 * encabezado y hay que propagarla al resto de sus líneas.
 */
export function normalizarItemsBistrosoft(items: ItemCrudo[], dia: string): ResultadoNormalizacion[] {
  const anulados = new Set<string>()
  for (const item of items) {
    const clave = claveTicket(item)
    const status = String(item.status ?? '').toUpperCase()
    if (clave && clasificar(String(item.transactionType ?? '')) === 'encabezado' && status.startsWith('VOID')) {
      anulados.add(clave)
    }
  }

  return items.map((item, indice): ResultadoNormalizacion => {
    const importe = numero(item.amount)
    if (importe === null) return { ok: false, motivo: 'Sin importe reconocible', raw: item }

    const tipo = clasificar(String(item.transactionType ?? ''))
    const tipoLinea = TIPO_LINEA[tipo]
    const momento = fechaHora(item)
    const clave = claveTicket(item)
    const esProducto = tipo === 'producto' || tipo === 'componente'

    // Los movimientos de caja no tienen ticket (ticketNumber 0): cada uno es su propia operación.
    const transaccionId = clave ?? `caja-${momento ?? 'sin-hora'}-${indice}`

    const ticket = numero(item.ticketNumber)
    const linea: LineaVentaNormalizada = {
      localCodigo: texto(item.shopCode),
      localNombre: texto(item.shop),
      transaccionId,
      documento: ticket ? String(ticket) : null,
      tipoDocumento: tipo === 'encabezado' ? texto(item.transactionType) : null,
      // El día operativo es el consultado (una venta de la 01:30 pertenece al día anterior).
      fecha: dia,
      fechaHora: momento,
      modificadoMs: null,
      tipoLinea,
      productoCodigo: esProducto ? texto(item.sku) : null,
      productoNombre: esProducto
        ? texto(item.product)
        : tipo === 'descuento'
          ? 'Descuento'
          : tipo === 'caja'
            ? texto(item.transactionType)
            : null,
      categoria: esProducto ? texto(item.category) : null,
      cantidad: tipo === 'producto' ? (numero(item.quantity) ?? 0) : 0,
      precioUnitario: numero(item.unitPrice),
      importe,
      descuento: tipo === 'descuento' ? -importe : 0,
      medioPago: texto(item.paymentMethod),
      canal: canal(item.origin),
      vendedor: texto(item.waiter) ?? texto(item.user) ?? texto(item.seller),
      caja: texto(item.cashRegister) ?? texto(item.cashbox) ?? texto(item.box),
      estadoOrigen: texto(item.status),
      anulada: clave !== null && anulados.has(clave),
      raw: sinDatosPrivados(item),
    }
    return { ok: true, linea }
  })
}
