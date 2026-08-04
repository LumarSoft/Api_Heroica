import {
  ConceptoIgnorado,
  ConceptoSinRegla,
  DesgloseNeto,
  FilaNormalizada,
  MovimientoPropuesto,
  PreviewImportacion,
  ReglaConcepto,
  ResultadoParse,
} from './types'
import { hashearFilas } from './utils'

/**
 * ============================================================
 *  AGRUPADOR — filas del extracto → movimientos de la caja banco
 * ============================================================
 *
 * Esta es la etapa que reemplaza el trabajo manual: hoy tesorería suma a mano los
 * totales de cada concepto por día antes de cargarlos. Acá se hace lo mismo, pero
 * la suma queda auditada fila por fila.
 *
 * Función pura: no toca la base de datos. Recibe las reglas y los hashes ya
 * existentes como parámetros, así se puede testear sin conexión.
 *
 * Cada fila del extracto cae en exactamente uno de cuatro cajones:
 *
 *   1. YA IMPORTADA  — su hash ya existe. Se omite (esto es lo que hace seguro
 *                      resubir el acumulado todos los días).
 *   2. IGNORADA      — la regla dice `accion: 'ignorar'`. Se cuenta y se informa,
 *                      pero no genera movimiento.
 *   3. SIN REGLA     — el banco trae un concepto que no está en el archivo de
 *                      reglas. Se informa para que alguien lo agregue.
 *   4. IMPORTABLE    — genera (o alimenta) un movimiento.
 *
 * El desglose de montos de los cuatro cajones se devuelve en `desglose`, y su
 * suma tiene que dar el neto del archivo. Es lo que permite mostrarle al usuario
 * cuánta plata del extracto no va a llegar a la caja, y por qué.
 */

export interface EntradaAgrupacion {
  parse: ResultadoParse
  /** Reglas fijas del banco, indexadas por código de concepto. */
  reglas: ReadonlyMap<string, ReglaConcepto>
  /** Hashes de filas ya importadas para esta sucursal + banco. */
  hashesExistentes: ReadonlySet<string>
  sucursalId: number
  bancoId: number
  archivoHash: string
}

export function construirPreview(entrada: EntradaAgrupacion): PreviewImportacion {
  const { parse, reglas, hashesExistentes, sucursalId, bancoId, archivoHash } = entrada

  const hashes = hashearFilas(parse.filas)
  const advertencias = [...parse.advertencias]

  // Un mismo archivo podría traer dos filas que colapsen al mismo hash. No debería
  // pasar, pero si el banco repite un ID de operación queremos enterarnos y no
  // perder plata en silencio.
  const vistosEnArchivo = new Set<string>()

  const importables: Array<{ fila: FilaNormalizada; hash: string; regla: ReglaConcepto }> = []
  const ignorados = new Map<string, ConceptoIgnorado>()
  const sinRegla = new Map<string, ConceptoSinRegla & { _contrapartes: Set<string> }>()

  let filasOmitidas = 0
  let filasIgnoradas = 0
  let netoYaImportado = 0

  parse.filas.forEach((fila, i) => {
    const hash = hashes[i]

    // ── 1. Ya importada ───────────────────────────────────────────────────────
    if (hashesExistentes.has(hash)) {
      filasOmitidas++
      netoYaImportado += fila.monto
      return
    }
    if (vistosEnArchivo.has(hash)) {
      filasOmitidas++
      netoYaImportado += fila.monto
      advertencias.push(
        `El archivo trae dos filas indistinguibles entre sí (fecha ${fila.fecha}, concepto ` +
          `${fila.conceptoCodigo}, monto ${fila.monto.toFixed(2)}). Se importó una sola.`,
      )
      return
    }
    vistosEnArchivo.add(hash)

    const regla = reglas.get(fila.conceptoCodigo)

    // ── 3. Sin regla ──────────────────────────────────────────────────────────
    if (!regla) {
      const existente = sinRegla.get(fila.conceptoCodigo)
      if (existente) {
        existente.cantidadFilas++
        existente.montoTotal = redondear(existente.montoTotal + fila.monto)
        existente.tipoSugerido = existente.montoTotal >= 0 ? 'ingreso' : 'egreso'
        if (fila.contraparte) existente._contrapartes.add(fila.contraparte)
      } else {
        sinRegla.set(fila.conceptoCodigo, {
          codigo: fila.conceptoCodigo,
          conceptoDescripcion: fila.conceptoDescripcion,
          grupoDescripcion: fila.grupoDescripcion,
          descripcionBanco: fila.descripcionBanco,
          contrapartes: [],
          _contrapartes: new Set(fila.contraparte ? [fila.contraparte] : []),
          cantidadFilas: 1,
          montoTotal: fila.monto,
          tipoSugerido: fila.monto >= 0 ? 'ingreso' : 'egreso',
        })
      }
      return
    }

    // ── 2. Ignorada por regla ─────────────────────────────────────────────────
    if (regla.accion === 'ignorar') {
      filasIgnoradas++
      const existente = ignorados.get(regla.codigo)
      if (existente) {
        existente.cantidadFilas++
        existente.montoTotal = redondear(existente.montoTotal + fila.monto)
      } else {
        ignorados.set(regla.codigo, {
          codigo: regla.codigo,
          nombreBanco: regla.nombreBanco,
          motivo: regla.motivo ?? 'Sin motivo declarado en las reglas.',
          cantidadFilas: 1,
          montoTotal: fila.monto,
        })
      }
      return
    }

    // ── 4. Importable ─────────────────────────────────────────────────────────
    if (!regla.destino) {
      advertencias.push(
        `La regla del concepto ${regla.codigo} dice "importar" pero no define destino. ` +
          `Se saltearon sus filas — revisar el archivo de reglas del banco.`,
      )
      return
    }
    importables.push({ fila, hash, regla })
  })

  // ── Agrupación ──────────────────────────────────────────────────────────────
  // La clave NO incluye el tipo (ingreso/egreso) a propósito: así un concepto que
  // resta —las devoluciones Nave, por ejemplo— cae en el mismo movimiento que las
  // cobranzas y se netea solo. El tipo final se deriva del signo del neto.
  const acumulador = new Map<string, MovimientoPropuesto>()

  for (const { fila, hash, regla } of importables) {
    const destino = regla.destino!
    const monto = destino.invertirSigno ? -fila.monto : fila.monto

    // El concepto es opcional: por defecto se usa la descripción.
    const conceptoDestino = destino.concepto ?? destino.descripcion

    const huellaDestino = [
      conceptoDestino,
      destino.descripcion,
      destino.categoria,
      destino.subcategoria,
      destino.medioPago,
      destino.proveedor ?? '',
    ].join('|')

    const clave = destino.agrupacion === 'individual' ? `ind:${hash}` : `dia:${fila.fecha}|${huellaDestino}`

    const existente = acumulador.get(clave)
    if (existente) {
      existente.monto = redondear(existente.monto + monto)
      existente.cantidadFilas++
      existente.filaHashes.push(hash)
      if (!existente.codigosBanco.includes(regla.codigo)) existente.codigosBanco.push(regla.codigo)
    } else {
      acumulador.set(clave, {
        fecha: fila.fecha,
        concepto: conceptoDestino,
        descripcion: destino.descripcion,
        categoria: destino.categoria,
        subcategoria: destino.subcategoria,
        medioPago: destino.medioPago,
        proveedor: destino.proveedor,
        monto: redondear(monto),
        tipo: destino.tipoEsperado,
        cantidadFilas: 1,
        codigosBanco: [regla.codigo],
        filaHashes: [hash],
      })
    }
  }

  const movimientos = [...acumulador.values()].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.concepto.localeCompare(b.concepto),
  )

  // El signo real manda sobre el tipo declarado en la regla: si un concepto que
  // esperábamos de ingreso termina negativo, la caja tiene que reflejar la realidad.
  for (const m of movimientos) {
    if (m.monto === 0) {
      advertencias.push(
        `"${m.concepto}" del ${m.fecha} suma $0 al consolidar ${m.cantidadFilas} filas (se compensan entre sí).`,
      )
      continue
    }
    const tipoReal: 'ingreso' | 'egreso' = m.monto < 0 ? 'egreso' : 'ingreso'
    if (tipoReal !== m.tipo) {
      advertencias.push(
        `"${m.concepto}" del ${m.fecha} se esperaba como ${m.tipo} pero el neto da ` +
          `${m.monto.toFixed(2)}. Se importa como ${tipoReal}.`,
      )
      m.tipo = tipoReal
    }
  }

  // ── Desglose de montos ──────────────────────────────────────────────────────
  const desglose: DesgloseNeto = {
    netoArchivo: redondear(parse.filas.reduce((a, f) => a + f.monto, 0)),
    netoImportado: redondear(movimientos.reduce((a, m) => a + m.monto, 0)),
    netoIgnorado: redondear([...ignorados.values()].reduce((a, c) => a + c.montoTotal, 0)),
    netoYaImportado: redondear(netoYaImportado),
    netoSinRegla: redondear([...sinRegla.values()].reduce((a, c) => a + c.montoTotal, 0)),
  }

  const suma = redondear(
    desglose.netoImportado + desglose.netoIgnorado + desglose.netoYaImportado + desglose.netoSinRegla,
  )
  if (Math.abs(suma - desglose.netoArchivo) > 0.01) {
    advertencias.push(
      `Descuadre interno del desglose: las partes suman ${suma.toFixed(2)} y el archivo ` +
        `${desglose.netoArchivo.toFixed(2)}. Es un bug del importador, no del extracto.`,
    )
  }

  const fechas = parse.filas.map(f => f.fecha).sort()

  return {
    adapter: parse.adapter,
    bancoId,
    sucursalId,
    cuentaDetectada: parse.cuentaDetectada,
    moneda: parse.moneda,
    archivoHash,
    fechaDesde: fechas[0] ?? null,
    fechaHasta: fechas[fechas.length - 1] ?? null,

    filasTotales: parse.filas.length,
    filasNuevas: importables.length,
    filasOmitidas,
    filasIgnoradas,

    movimientos,
    conceptosIgnorados: [...ignorados.values()].sort((a, b) => Math.abs(b.montoTotal) - Math.abs(a.montoTotal)),
    conceptosSinRegla: [...sinRegla.values()]
      .map(({ _contrapartes, ...c }) => ({ ...c, contrapartes: [...(_contrapartes as Set<string>)].slice(0, 10) }))
      .sort((a, b) => b.cantidadFilas - a.cantidadFilas),
    advertencias,

    desglose,
    controlSaldo: calcularControlSaldo(parse.filas, desglose.netoArchivo),
  }
}

/**
 * Control de integridad del PARSEO. Compara el neto de todas las filas leídas
 * contra la variación de saldo que declara el propio banco.
 *
 * Deliberadamente se calcula sobre TODAS las filas del archivo, no sobre las que
 * se van a importar: así sigue siendo una red de seguridad válida aunque las
 * reglas descarten la mayor parte del volumen. Si esto no cuadra, el adapter leyó
 * mal una columna — y eso hay que verlo en el preview, no después de impactar la caja.
 */
function calcularControlSaldo(filas: FilaNormalizada[], netoArchivo: number): PreviewImportacion['controlSaldo'] {
  if (filas.length === 0) return null

  const primera = filas[0]
  const ultima = filas[filas.length - 1]
  if (primera.saldoBanco === null || ultima.saldoBanco === null) return null

  // saldoInicial = saldo de la primera fila menos su propio movimiento
  const saldoInicial = primera.saldoBanco - primera.monto
  const esperado = redondear(ultima.saldoBanco - saldoInicial)

  return { esperado, calculado: netoArchivo, cuadra: Math.abs(esperado - netoArchivo) < 0.01 }
}

function redondear(n: number): number {
  return Number(n.toFixed(2))
}
