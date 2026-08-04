import JSZip from 'jszip'
import ExcelJS, { Workbook } from 'exceljs'

/**
 * ============================================================
 *  COMPATIBILIDAD DE LECTURA DE XLSX
 * ============================================================
 *
 * PROBLEMA (detectado con un extracto real de Banco Galicia):
 *
 * El estándar ECMA-376 admite dos formas de guardar una fecha en una celda:
 *
 *   a) como número de serie de Excel   → <c r="A2" s="4"><v>46230</v></c>
 *   b) como ISO-8601 con t="d"         → <c r="A2" s="4" t="d"><v>2026-07-27T00:00:00.000Z</v></c>
 *
 * Casi todos los generadores usan (a). Galicia usa (b), y exceljs 4.4.0 no
 * implementa `t="d"`: le aplica parseFloat al ISO, obtiene 2026 (el año), y lo
 * trata como número de serie. Resultado: TODAS las fechas del extracto se leen
 * como 1905-07-18.
 *
 * Es un fallo silencioso y grave — no lanza excepción, simplemente carga los
 * movimientos con una fecha equivocada. Y para cuando el valor llega a la
 * aplicación el día y el mes ya se perdieron: no se puede corregir después.
 *
 * SOLUCIÓN:
 *
 * Antes de entregarle el archivo a exceljs, se reescriben las celdas `t="d"`
 * convirtiendo el ISO al número de serie equivalente. El formato de número de la
 * celda (numFmtId 14 = fecha) queda intacto, así que exceljs la reconoce como
 * fecha y devuelve el Date correcto.
 *
 * jszip ya es dependencia directa de exceljs, así que esto no agrega peso al bundle.
 *
 * Al agregar un banco nuevo: usá SIEMPRE `cargarWorkbook()` en lugar de
 * `workbook.xlsx.load()` directo, para no reintroducir el bug.
 */

/** Días entre el epoch de Excel (1899-12-30) y el epoch de Unix. */
const EPOCH_EXCEL_A_UNIX = 25569
const MS_POR_DIA = 86400000

/**
 * Celda con t="d". Se capturan los atributos previos y posteriores a t="d" para
 * poder reescribir la celda conservando `r`, `s` y cualquier otro atributo.
 */
const REGEX_CELDA_FECHA = /<c([^>]*?)\st="d"([^>]*?)>\s*<v>([^<]*)<\/v>\s*<\/c>/g

function isoASerialExcel(iso: string): number | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return ms / MS_POR_DIA + EPOCH_EXCEL_A_UNIX
}

/** Reescribe las celdas t="d" de un XML de hoja. Devuelve el XML y cuántas convirtió. */
export function repararFechasISOEnXml(xml: string): { xml: string; convertidas: number } {
  let convertidas = 0

  const reparado = xml.replace(REGEX_CELDA_FECHA, (original, attrsPre, attrsPost, valor) => {
    const serial = isoASerialExcel(valor)
    if (serial === null) return original
    convertidas++
    return `<c${attrsPre}${attrsPost}><v>${serial}</v></c>`
  })

  return { xml: reparado, convertidas }
}

export interface ResultadoCarga {
  workbook: Workbook
  /** Cantidad de celdas de fecha ISO que hubo que convertir. 0 = archivo estándar. */
  fechasReparadas: number
}

/**
 * Carga un .xlsx a un Workbook de exceljs, reparando primero las celdas de fecha
 * en formato ISO. Este es el único punto de entrada que deberían usar los adapters.
 */
export async function cargarWorkbook(buffer: Buffer): Promise<ResultadoCarga> {
  let fechasReparadas = 0
  let bufferFinal = buffer

  try {
    const zip = await JSZip.loadAsync(buffer)

    const hojas = Object.keys(zip.files).filter(
      nombre => /^xl\/worksheets\/[^/]+\.xml$/i.test(nombre) && !zip.files[nombre].dir,
    )

    let huboCambios = false
    for (const nombre of hojas) {
      const xml = await zip.files[nombre].async('string')
      if (!xml.includes('t="d"')) continue

      const { xml: reparado, convertidas } = repararFechasISOEnXml(xml)
      if (convertidas > 0) {
        zip.file(nombre, reparado)
        fechasReparadas += convertidas
        huboCambios = true
      }
    }

    if (huboCambios) {
      bufferFinal = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    }
  } catch {
    // Si el pre-procesamiento falla (archivo no-zip, corrupto, etc.) se deja que
    // exceljs lance su propio error, que es más descriptivo para el usuario.
    bufferFinal = buffer
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bufferFinal as unknown as ExcelJS.Buffer)

  return { workbook, fechasReparadas }
}
