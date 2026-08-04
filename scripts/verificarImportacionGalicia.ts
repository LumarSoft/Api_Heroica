 
/**
 * Verificación del pipeline de importación bancaria de Galicia contra un extracto real.
 * Usa las reglas fijas del adapter. No toca la base de datos.
 *
 *   pnpm verificar:import-galicia "<ruta-al-extracto.xlsx>"
 */
import fs from 'fs'
import path from 'path'
import { construirPreview } from '../src/services/importacionBancaria/agrupador'
import { galiciaAdapter } from '../src/services/importacionBancaria/adapters/galiciaAdapter'
import { detectarAdapter } from '../src/services/importacionBancaria/registry'
import { sha256 } from '../src/services/importacionBancaria/utils'
import { cargarWorkbook } from '../src/services/importacionBancaria/xlsxCompat'

const ruta = process.argv[2]
if (!ruta) {
  console.error('Uso: pnpm verificar:import-galicia "<archivo.xlsx>"')
  process.exit(1)
}

const errores: string[] = []
const chequear = (ok: boolean, mensaje: string) => {
  if (!ok) errores.push(mensaje)
}

async function main() {
  const buffer = fs.readFileSync(ruta)
  const nombreArchivo = path.basename(ruta)

  const { workbook, fechasReparadas } = await cargarWorkbook(buffer)
  const detectado = detectarAdapter(workbook, nombreArchivo)

  console.log(`\n▸ Archivo:  ${nombreArchivo}`)
  console.log(`▸ Adapter detectado: ${detectado ? detectado.clave : '(ninguno)'}`)
  console.log(`▸ Celdas de fecha ISO reparadas: ${fechasReparadas}`)

  const parse = galiciaAdapter.parse(workbook, nombreArchivo)
  console.log(
    `▸ Cuenta: ${parse.cuentaDetectada} · filas: ${parse.filas.length} · rango: ${parse.filas[0].fecha} → ${parse.filas[parse.filas.length - 1].fecha}`,
  )
  console.log(`▸ Advertencias del parseo: ${parse.advertencias.length}`)
  parse.advertencias.slice(0, 5).forEach(a => console.log(`    • ${a}`))

  const base = {
    parse,
    reglas: galiciaAdapter.reglas,
    sucursalId: 1,
    bancoId: 1,
    archivoHash: sha256(buffer),
  }

  // ── Corrida 1: base vacía ───────────────────────────────────────────────────
  const p1 = construirPreview({ ...base, hashesExistentes: new Set<string>() })
  imprimir('CORRIDA 1 — primera importación', p1)

  chequear(
    p1.controlSaldo !== null && p1.controlSaldo.cuadra,
    `El neto del archivo (${p1.desglose.netoArchivo}) no coincide con la variación de saldo ` +
      `del banco (${p1.controlSaldo?.esperado}). Hay un error de parseo.`,
  )
  chequear(
    p1.conceptosSinRegla.length === 0,
    `Quedaron ${p1.conceptosSinRegla.length} concepto(s) sin regla: ${p1.conceptosSinRegla.map(c => c.codigo).join(', ')}.`,
  )

  // Las cobranzas Nave (tarjeta + transferencia + devoluciones) tienen que
  // consolidarse en un único movimiento por día.
  const nave = p1.movimientos.filter(m => m.descripcion === 'Nave')
  const codigosNave = new Set(nave.flatMap(m => m.codigosBanco))
  chequear(nave.length > 0, 'No se generó ningún movimiento de cobranzas Nave.')
  chequear(
    nave.length === new Set(nave.map(m => m.fecha)).size,
    'Cobranzas Nave debería tener exactamente un movimiento por día.',
  )
  chequear(
    [...codigosNave].every(c => ['917403', '917761', '907389'].includes(c)),
    `Cobranzas Nave consolidó códigos inesperados: ${[...codigosNave].join(', ')}.`,
  )
  chequear(
    nave.every(m => m.categoria === 'VENTA LOCAL' && m.subcategoria === 'Transferencia'),
    'Cobranzas Nave debería ir a VENTA LOCAL > Transferencia.',
  )

  // Ningún movimiento puede quedar sin catálogos: son campos obligatorios en
  // `movimientos` y el INSERT fallaría a mitad de la transacción.
  chequear(
    p1.movimientos.every(m => m.descripcion && m.categoria && m.subcategoria && m.medioPago),
    'Hay movimientos propuestos sin descripción, categoría, subcategoría o medio de pago.',
  )

  // Un movimiento por (fecha + destino): no puede haber dos con la misma clave.
  const claves = p1.movimientos.map(m => `${m.fecha}|${m.descripcion}|${m.categoria}|${m.subcategoria}`)
  chequear(
    new Set(claves).size === claves.filter((_, i) => p1.movimientos[i].cantidadFilas > 0).length ||
      new Set(claves).size === claves.length,
    'Hay movimientos duplicados para la misma fecha y destino.',
  )

  const d = p1.desglose
  chequear(
    Math.abs(d.netoImportado + d.netoIgnorado + d.netoYaImportado + d.netoSinRegla - d.netoArchivo) < 0.01,
    'El desglose no suma el neto del archivo.',
  )

  // ── Corrida 2: se resube el mismo archivo ───────────────────────────────────
  const yaImportados = new Set(p1.movimientos.flatMap(m => m.filaHashes))
  const p2 = construirPreview({ ...base, hashesExistentes: yaImportados })
  imprimir('CORRIDA 2 — se resube el mismo archivo', p2)

  chequear(
    p2.movimientos.length === 0,
    `Al resubir se propusieron ${p2.movimientos.length} movimientos; deberían ser 0.`,
  )
  chequear(
    p2.desglose.netoImportado === 0,
    `El neto a importar al resubir debería ser 0, dio ${p2.desglose.netoImportado}.`,
  )

  console.log('')
  if (errores.length === 0) {
    console.log('✅ Todas las verificaciones pasaron.')
  } else {
    console.log('❌ Verificaciones fallidas:')
    errores.forEach(e => console.log(`    • ${e}`))
    process.exitCode = 1
  }
}

function imprimir(titulo: string, p: ReturnType<typeof construirPreview>) {
  console.log(`\n${'─'.repeat(86)}\n${titulo}\n${'─'.repeat(86)}`)
  console.log(
    `filas: ${p.filasTotales} totales · ${p.filasNuevas} a importar · ${p.filasOmitidas} ya cargadas · ${p.filasIgnoradas} ignoradas`,
  )

  const d = p.desglose
  console.log('')
  console.log(`  Neto del archivo      ${fmt(d.netoArchivo).padStart(18)}`)
  console.log(`    → se importa        ${fmt(d.netoImportado).padStart(18)}`)
  console.log(`    → se ignora         ${fmt(d.netoIgnorado).padStart(18)}`)
  console.log(`    → ya estaba cargado ${fmt(d.netoYaImportado).padStart(18)}`)
  console.log(`    → sin regla         ${fmt(d.netoSinRegla).padStart(18)}`)

  if (p.controlSaldo) {
    const { esperado, calculado, cuadra } = p.controlSaldo
    console.log(
      `\n  Control de parseo: banco ${fmt(esperado)} vs leído ${fmt(calculado)} → ${cuadra ? 'CUADRA ✅' : 'NO CUADRA ❌'}`,
    )
  }

  if (p.movimientos.length) {
    console.log(`\n  MOVIMIENTOS A CREAR (${p.movimientos.length})`)
    console.log(
      `  ${'FECHA'.padEnd(12)}${'CONCEPTO'.padEnd(32)}${'FILAS'.padStart(6)}${'MONTO'.padStart(18)}   CÓDIGOS`,
    )
    for (const m of p.movimientos.slice(0, 18)) {
      console.log(
        `  ${m.fecha.padEnd(12)}${m.concepto.slice(0, 30).padEnd(32)}${String(m.cantidadFilas).padStart(6)}` +
          `${fmt(m.monto).padStart(18)}   ${m.codigosBanco.join(',')}`,
      )
    }
    if (p.movimientos.length > 18) console.log(`  … y ${p.movimientos.length - 18} movimientos más`)
  }

  if (p.conceptosIgnorados.length) {
    console.log(`\n  ⚠ IGNORADOS — esto es lo que hay que mostrar en el modal antes de confirmar:`)
    for (const c of p.conceptosIgnorados) {
      console.log(
        `    ${c.codigo}  ${c.nombreBanco.slice(0, 38).padEnd(40)}${String(c.cantidadFilas).padStart(5)} filas ${fmt(c.montoTotal).padStart(17)}`,
      )
      console.log(`            ${c.motivo}`)
    }
  }

  if (p.conceptosSinRegla.length) {
    console.log('\n  ❌ SIN REGLA (hay que agregarlos a galiciaReglas.ts):')
    for (const c of p.conceptosSinRegla) {
      console.log(`    ${c.codigo} — ${c.conceptoDescripcion} (${c.cantidadFilas} filas, ${fmt(c.montoTotal)})`)
    }
  }

  if (p.advertencias.length) {
    console.log('\n  Advertencias:')
    p.advertencias.slice(0, 8).forEach(a => console.log(`    • ${a}`))
    if (p.advertencias.length > 8) console.log(`    … y ${p.advertencias.length - 8} más`)
  }
}

function fmt(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

main().catch(err => {
  console.error('\n❌ Error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
