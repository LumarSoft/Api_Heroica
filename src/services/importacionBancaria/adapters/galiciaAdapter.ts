import type { Workbook, Worksheet } from 'exceljs'
import { BancoAdapter, ErrorDeFormato, FilaNormalizada, ResultadoParse } from '../types'
import { REGLAS_GALICIA_POR_CODIGO } from './galiciaReglas'
import { celdaTexto, parseFecha, parseMonto, separarCodigoDescripcion, ubicarHeaders } from '../utils'

/**
 * ============================================================
 *  ADAPTER — BANCO GALICIA (Office Banking, "Extracto" en Excel)
 * ============================================================
 *
 * Layout observado (Extracto_CC<nro-cuenta>.xlsx, hoja "Movimientos", header en fila 1):
 *
 *   Fecha | Descripción | Origen | Débitos | Créditos | Grupo de Conceptos | Concepto |
 *   Número de Terminal | Observaciones Cliente | Número de Comprobante |
 *   Leyendas Adicionales 1..4 | Tipo de Movimiento | Saldo
 *
 * Particularidades que resuelve este adapter:
 *
 *   - Débitos y Créditos vienen en columnas separadas, con 0 en la que no aplica.
 *     Se unifican en un `monto` signado (+ crédito / − débito).
 *   - "Grupo de Conceptos" y "Concepto" vienen como "<código> - <texto>". El código es
 *     lo estable: hay dos conceptos distintos (907232 y 907269) que comparten el texto
 *     "TRF INMED PROVEED", así que mapear por nombre daría un falso positivo.
 *   - El ID de operación viaja dentro de "Leyendas Adicionales 1" con el prefijo
 *     "Operación " (ej. "Operación IAZ757927708"). No todas las filas lo traen:
 *     impuestos y echeqs vienen sin él y caen al hash por saldo corriente.
 *   - "Saldo" es el saldo corriente después de cada movimiento. Se usa como control
 *     de integridad del parseo (ver `validarSaldoCorriente`).
 *   - "Tipo de Movimiento" es Imputado | Pendiente. Se guarda como `estadoBanco` para
 *     auditoría, pero por decisión de negocio todo se importa a saldo real.
 */

const HOJA_ESPERADA = 'Movimientos'

const HEADERS_REQUERIDOS = ['Fecha', 'Débitos', 'Créditos', 'Concepto']

const COL = {
  fecha: 'fecha',
  descripcion: 'descripcion',
  debitos: 'debitos',
  creditos: 'creditos',
  grupo: 'grupo de conceptos',
  concepto: 'concepto',
  observaciones: 'observaciones cliente',
  comprobante: 'numero de comprobante',
  leyenda1: 'leyendas adicionales 1',
  leyenda2: 'leyendas adicionales 2',
  leyenda3: 'leyendas adicionales 3',
  leyenda4: 'leyendas adicionales 4',
  tipoMovimiento: 'tipo de movimiento',
  saldo: 'saldo',
} as const

/** "Extracto_CC2131100751 (6).xlsx" → "CC2131100751" */
function detectarCuenta(nombreArchivo: string): string | null {
  const m = nombreArchivo.match(/([A-Z]{2}\d{6,})/i)
  return m ? m[1].toUpperCase() : null
}

/**
 * Las "Leyendas Adicionales" son un cajón de sastre: en unas filas traen el ID de
 * operación ("Operación IAZ757927708") y en otras el nombre de la contraparte
 * ("Drovandi Distribuciones Srl"). Se recorren las 4 columnas en vez de asumir que
 * el ID siempre está en la primera.
 */
function interpretarLeyendas(leyendas: string[]): { operacionId: string | null; contraparte: string | null } {
  let operacionId: string | null = null
  const otras: string[] = []

  for (const leyenda of leyendas) {
    if (!leyenda) continue
    const m = leyenda.match(/operaci[oó]n\s+([A-Za-z0-9-]+)/i)
    if (m && !operacionId) {
      operacionId = m[1].toUpperCase()
    } else if (!m) {
      otras.push(leyenda)
    }
  }

  return { operacionId, contraparte: otras.length > 0 ? otras.join(' ').trim() : null }
}

/**
 * Backstop contra errores de parseo de fecha. Ya nos pasó una vez que una fecha de
 * 2026 se leyera como 1905 (ver `xlsxCompat.ts`); si algo así vuelve a ocurrir con
 * otro layout, queremos que salte en el preview y no que se impacte la caja.
 */
function fechaEsPlausible(fecha: string): boolean {
  const anio = Number(fecha.slice(0, 4))
  const anioActual = new Date().getFullYear()
  return anio >= 2000 && anio <= anioActual + 1
}

function elegirHoja(workbook: Workbook): Worksheet | null {
  const porNombre = workbook.getWorksheet(HOJA_ESPERADA)
  if (porNombre) return porNombre
  return workbook.worksheets[0] ?? null
}

export const galiciaAdapter: BancoAdapter = {
  clave: 'galicia',
  nombre: 'Banco Galicia',
  aliasesBanco: ['galicia'],
  reglas: REGLAS_GALICIA_POR_CODIGO,

  detectar(workbook: Workbook, nombreArchivo: string): boolean {
    const hoja = elegirHoja(workbook)
    if (!hoja) return false

    const headers = ubicarHeaders(hoja, HEADERS_REQUERIDOS)
    if (!headers) return false

    // Firma inequívoca de Galicia: separa Débitos/Créditos Y trae "Grupo de Conceptos".
    const tieneGrupo = COL.grupo in headers.columnas
    const tieneLeyendas = COL.leyenda1 in headers.columnas
    const nombreCoincide = /extracto/i.test(nombreArchivo)

    return tieneGrupo && (tieneLeyendas || nombreCoincide)
  },

  parse(workbook: Workbook, nombreArchivo: string): ResultadoParse {
    const hoja = elegirHoja(workbook)
    if (!hoja) throw new ErrorDeFormato('El archivo no tiene ninguna hoja legible.')

    const headers = ubicarHeaders(hoja, HEADERS_REQUERIDOS)
    if (!headers) {
      throw new ErrorDeFormato(
        `No se encontró la fila de encabezados del extracto de Galicia. ` +
          `Se esperaban las columnas: ${HEADERS_REQUERIDOS.join(', ')}.`,
      )
    }

    const { filaHeader, columnas } = headers
    const advertencias: string[] = []
    const filas: FilaNormalizada[] = []

    const leer = (fila: ReturnType<Worksheet['getRow']>, clave: string): unknown => {
      const col = columnas[clave]
      return col ? fila.getCell(col).value : null
    }

    for (let i = filaHeader + 1; i <= hoja.rowCount; i++) {
      const fila = hoja.getRow(i)

      const fecha = parseFecha(leer(fila, COL.fecha))
      if (!fecha) {
        // Fila vacía o pie de tabla ("Total", leyendas legales, etc.). Se ignora sin ruido
        // salvo que tenga contenido en las columnas de importe.
        const debito = parseMonto(leer(fila, COL.debitos))
        const credito = parseMonto(leer(fila, COL.creditos))
        if (debito !== 0 || credito !== 0) {
          advertencias.push(`Fila ${i}: tiene importe pero no se pudo leer la fecha. Se omitió.`)
        }
        continue
      }

      const debitos = Math.abs(parseMonto(leer(fila, COL.debitos)))
      const creditos = Math.abs(parseMonto(leer(fila, COL.creditos)))

      if (debitos === 0 && creditos === 0) {
        advertencias.push(`Fila ${i}: sin débito ni crédito. Se omitió.`)
        continue
      }
      if (debitos !== 0 && creditos !== 0) {
        advertencias.push(
          `Fila ${i}: tiene débito y crédito simultáneos (${debitos} / ${creditos}). ` +
            `Se tomó el neto, revisar manualmente.`,
        )
      }

      // Signo: crédito suma, débito resta.
      const monto = Number((creditos - debitos).toFixed(2))

      const conceptoCrudo = celdaTexto(leer(fila, COL.concepto))
      const grupoCrudo = celdaTexto(leer(fila, COL.grupo))
      const concepto = separarCodigoDescripcion(conceptoCrudo)
      const grupo = grupoCrudo ? separarCodigoDescripcion(grupoCrudo) : null

      if (!concepto.codigo) {
        advertencias.push(`Fila ${i}: sin código de concepto. Se omitió.`)
        continue
      }

      const leyenda1 = celdaTexto(leer(fila, COL.leyenda1))
      const leyenda2 = celdaTexto(leer(fila, COL.leyenda2))
      const leyenda3 = celdaTexto(leer(fila, COL.leyenda3))
      const leyenda4 = celdaTexto(leer(fila, COL.leyenda4))
      const { operacionId, contraparte } = interpretarLeyendas([leyenda1, leyenda2, leyenda3, leyenda4])

      const saldoCrudo = leer(fila, COL.saldo)
      const comprobante = celdaTexto(leer(fila, COL.comprobante))

      if (!fechaEsPlausible(fecha)) {
        advertencias.push(
          `Fila ${i}: la fecha leída (${fecha}) es implausible. Puede haber un problema de ` +
            `formato en el archivo — revisar antes de confirmar la importación.`,
        )
      }

      filas.push({
        fecha,
        conceptoCodigo: concepto.codigo,
        conceptoDescripcion: concepto.descripcion,
        grupoCodigo: grupo?.codigo || null,
        grupoDescripcion: grupo?.descripcion || null,
        descripcionBanco: celdaTexto(leer(fila, COL.descripcion)),
        monto,
        operacionId,
        contraparte,
        estadoBanco: celdaTexto(leer(fila, COL.tipoMovimiento)) || null,
        saldoBanco:
          saldoCrudo === null || saldoCrudo === undefined || saldoCrudo === '' ? null : parseMonto(saldoCrudo),
        comprobante: comprobante || null,
        raw: {
          filaExcel: i,
          descripcion: celdaTexto(leer(fila, COL.descripcion)),
          debitos,
          creditos,
          grupoConceptos: grupoCrudo,
          concepto: conceptoCrudo,
          observacionesCliente: celdaTexto(leer(fila, COL.observaciones)),
          numeroComprobante: comprobante,
          leyenda1,
          leyenda2,
          leyenda3,
          leyenda4,
          tipoMovimiento: celdaTexto(leer(fila, COL.tipoMovimiento)),
        },
      })
    }

    if (filas.length === 0) {
      throw new ErrorDeFormato('El extracto no contiene movimientos legibles.')
    }

    advertencias.push(...validarSaldoCorriente(filas))

    return {
      adapter: galiciaAdapter.clave,
      cuentaDetectada: detectarCuenta(nombreArchivo),
      moneda: 'ARS',
      filas,
      advertencias,
    }
  },
}

/**
 * Control de integridad: en Galicia la columna Saldo es un saldo corriente, así que
 * saldo[n] − saldo[n−1] tiene que ser exactamente el monto de la fila n. Si esto no
 * cierra, el parseo leyó mal una columna o el archivo viene desordenado — mejor
 * enterarse en el preview que después de impactar la caja.
 */
function validarSaldoCorriente(filas: FilaNormalizada[]): string[] {
  const avisos: string[] = []
  const TOLERANCIA = 0.01
  let desfases = 0

  for (let i = 1; i < filas.length; i++) {
    const anterior = filas[i - 1].saldoBanco
    const actual = filas[i].saldoBanco
    if (anterior === null || actual === null) continue

    if (Math.abs(anterior + filas[i].monto - actual) > TOLERANCIA) {
      desfases++
      if (desfases <= 3) {
        avisos.push(
          `Descuadre de saldo en la fila ${filas[i].raw.filaExcel}: ` +
            `${anterior.toFixed(2)} ${filas[i].monto >= 0 ? '+' : '−'} ${Math.abs(filas[i].monto).toFixed(2)} ` +
            `debería dar ${actual.toFixed(2)}.`,
        )
      }
    }
  }

  if (desfases > 3) avisos.push(`… y ${desfases - 3} descuadres de saldo más.`)
  return avisos
}
