/**
 * Script: migrate_concepto_to_descripcion.ts
 * Ejecutar: pnpm tsx scripts/migrate_concepto_to_descripcion.ts
 *
 * Toma cada valor único de `movimientos.concepto`, lo inserta en la tabla
 * `descripciones` si no existe, y luego actualiza `movimientos.descripcion_id`
 * con el id correspondiente para no perder los datos históricos.
 */

import mysql from 'mysql2/promise'
import * as dotenv from 'dotenv'

dotenv.config()

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  })

  console.log(`\n🔗 Conectado a ${process.env.DB_DATABASE} en ${process.env.DB_HOST}\n`)

  // ── Paso 1: Ver el estado actual ──────────────────────────────────────────

  const [totalRows] = await connection.execute<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) as total FROM movimientos WHERE concepto IS NOT NULL AND TRIM(concepto) != ""',
  )
  const [alreadyLinked] = await connection.execute<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) as total FROM movimientos WHERE descripcion_id IS NOT NULL',
  )

  console.log(`📊 Movimientos con concepto no vacío : ${totalRows[0].total}`)
  console.log(`📊 Movimientos ya con descripcion_id : ${alreadyLinked[0].total}`)

  // ── Paso 2: Insertar conceptos únicos en descripciones ────────────────────

  const [insertResult] = await connection.execute<mysql.ResultSetHeader>(
    `INSERT INTO \`descripciones\` (\`nombre\`, \`activo\`)
     SELECT DISTINCT TRIM(m.concepto), 1
     FROM \`movimientos\` m
     WHERE m.concepto IS NOT NULL
       AND TRIM(m.concepto) != ''
       AND NOT EXISTS (
         SELECT 1 FROM \`descripciones\` d WHERE d.nombre = TRIM(m.concepto)
       )`,
  )

  console.log(`\n✅ Paso 1 — Descripciones nuevas insertadas: ${insertResult.affectedRows}`)

  // ── Paso 3: Linkear movimientos con su descripción ────────────────────────

  const [updateResult] = await connection.execute<mysql.ResultSetHeader>(
    `UPDATE \`movimientos\` m
     JOIN \`descripciones\` d ON d.nombre = TRIM(m.concepto)
     SET m.descripcion_id = d.id
     WHERE m.concepto IS NOT NULL
       AND TRIM(m.concepto) != ''
       AND m.descripcion_id IS NULL`,
  )

  console.log(`✅ Paso 2 — Movimientos actualizados con descripcion_id: ${updateResult.affectedRows}`)

  // ── Verificación final ────────────────────────────────────────────────────

  const [sinDesc] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM movimientos
     WHERE descripcion_id IS NULL AND concepto IS NOT NULL AND TRIM(concepto) != ''`,
  )

  console.log(`\n🔎 Movimientos sin descripcion_id (deberían ser 0): ${sinDesc[0].total}`)

  // ── Mostrar resumen de descripciones generadas ────────────────────────────

  const [descripciones] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT d.id, d.nombre, COUNT(m.id) as movimientos
     FROM descripciones d
     LEFT JOIN movimientos m ON m.descripcion_id = d.id
     GROUP BY d.id, d.nombre
     ORDER BY movimientos DESC`,
  )

  console.log('\n📋 Descripciones en catálogo:\n')
  for (const row of descripciones) {
    console.log(`   [${row.id}] "${row.nombre}" — ${row.movimientos} movimiento(s)`)
  }

  await connection.end()
  console.log('\n🚀 Migración finalizada correctamente.\n')
}

main().catch(err => {
  console.error('❌ Error durante la migración:', err)
  process.exit(1)
})
