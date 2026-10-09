/**
 * Prueba de punta a punta contra el Bridge de ICG (Hiopos / HiOffice), sin tocar la base.
 *
 *   pnpm hiopos:probar                      → usa ayer
 *   pnpm hiopos:probar 2026-10-07           → un día puntual (elegí uno con ventas)
 *   pnpm hiopos:probar 2026-10-07 <GUID>    → probando otro exportationId
 *
 * Lee HIOPOS_EMAIL, HIOPOS_PASSWORD y HIOPOS_EXPORTATION_ID del .env. Hace login,
 * pide la plantilla de filtros del dashboard, exporta ese día, muestra las columnas
 * que llegan y cómo se normalizan, y cierra la sesión. Nunca imprime el token ni la contraseña.
 */
import dotenv from 'dotenv'
dotenv.config()

import { diagnosticarHiopos } from '../src/services/ventas/hioposDiagnostico'
import type { ConfigHiopos } from '../src/services/ventas/hioposMapeo'

const ayer = new Date(Date.now() - 3 * 3_600_000 - 86_400_000).toISOString().slice(0, 10)
const fecha = process.argv[2] ?? ayer
const exportationId = process.argv[3] ?? process.env.HIOPOS_EXPORTATION_ID ?? null

if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
  console.error('Uso: pnpm hiopos:probar [YYYY-MM-DD] [exportationId]')
  process.exit(1)
}

const config: ConfigHiopos = {
  exportationId,
  exportationIdOrigen: exportationId ? 'entorno' : null,
  attrFechaModificado: null,
  mapeo: {},
  columnasDetectadas: [],
  filtrosDashboard: [],
  diasPorTramo: 5,
  watermarkMs: null,
  verificadoAt: null,
  ultimoError: null,
}

async function main() {
  console.log(`\n▶ Diagnóstico Hiopos para el ${fecha}${exportationId ? '' : ' (sin exportationId: solo login)'}\n`)
  const r = await diagnosticarHiopos(config, fecha)
  for (const p of r.pasos) console.log(`${p.ok ? '✅' : '❌'} ${p.paso}: ${p.detalle}`)

  if (r.filtros.length) {
    console.log('\nFiltros del dashboard (attributeId · tipo · operador):')
    for (const f of r.filtros) console.log(`  - ${f.attributeId} · ${f.type} · ${f.arithmeticOperator}`)
    console.log(
      `  Filtro "Fecha Modificado" sugerido: ${r.attrFechaModificadoSugerido ?? 'no se pudo deducir (hay 0 o más de 1 Datetime BETWEEN)'}`,
    )
  }
  if (r.columnas.length) {
    console.log('\nColumnas que llegan (con ejemplos):')
    for (const c of r.columnas) console.log(`  - ${c.nombre}: ${c.ejemplos.join(' | ')}`)
    console.log('\nMapeo detectado (dato → columna):')
    for (const [campo, columna] of Object.entries(r.mapeoUsado)) console.log(`  - ${campo} → ${columna}`)
    if (r.faltantesMapeo.length) console.log(`\n⚠️  Falta: ${r.faltantesMapeo.join('; ')}`)
  }
  if (r.rechazadas.length) {
    console.log('\nFilas descartadas:')
    for (const x of r.rechazadas) console.log(`  - ${x.motivo}: ${x.cantidad}`)
  }
  if (r.ejemplos.length) {
    console.log('\nPrimeras líneas normalizadas:')
    for (const l of r.ejemplos.slice(0, 8)) {
      console.log(
        `  ${l.fecha} ${l.fechaHora?.slice(11) ?? '--:--'} · ${l.localNombre ?? '?'} · ${l.documento ?? l.transaccionId} · ${l.tipoLinea} · ${l.productoNombre ?? l.medioPago ?? ''} · ${l.cantidad} · $${l.importe}`,
      )
    }
  }
  console.log(
    `\n${r.ok ? '✅ Todo OK: la integración puede importar con esta configuración.' : '❌ Hay pasos con error (ver arriba).'}\n`,
  )
}

main()
  .catch(err => {
    console.error('Error inesperado:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => setTimeout(() => process.exit(), 200))
