import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

interface SolicitudAuditoria {
  id: number
  estado: string
  personal_id: number | null
  personal_nombre: string | null
  fecha: string
  detalles: string | Record<string, unknown> | null
  circuito_nuevo: number
  movimiento_id: number | null
}

interface PagoAuditoria {
  id: number
  fecha: string
  monto: string | number
  estado: string
  saldo: string | null
  concepto: string
  comentarios: string | null
}

const normalizar = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

async function auditar() {
  if (!process.env.DB_HOST || !process.env.DB_DATABASE) throw new Error('Falta la configuración de la base a revisar')
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectTimeout: 5000,
  })
  try {
    // Este comando sólo consulta información; no vincula solicitudes ni genera pagos.
    const [tables] = await connection.execute(
      "SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rrhh_adelantos_pagos'",
    )
    const tieneCircuito = (tables as unknown[]).length > 0
    const [solicitudesRows] = await connection.execute(`
      SELECT s.id, s.estado, s.personal_id, p.nombre AS personal_nombre,
             DATE_FORMAT(s.fecha_solicitud, '%Y-%m-%d') AS fecha, s.detalles,
             ${tieneCircuito ? 'a.solicitud_id IS NOT NULL' : '0'} AS circuito_nuevo,
             ${tieneCircuito ? 'a.movimiento_id' : 'NULL'} AS movimiento_id
      FROM rrhh_solicitudes s
      LEFT JOIN personal p ON p.id = s.personal_id
      ${tieneCircuito ? 'LEFT JOIN rrhh_adelantos_pagos a ON a.solicitud_id = s.id' : ''}
      WHERE s.tipo = 'Adelantos' AND s.deleted_at IS NULL
      ORDER BY s.id
    `)
    const solicitudes = solicitudesRows as SolicitudAuditoria[]
    const [pagosRows] = await connection.execute(`
      SELECT m.id, DATE_FORMAT(m.fecha, '%Y-%m-%d') AS fecha, m.monto,
             m.estado, m.saldo, m.concepto, m.comentarios
      FROM movimientos m
      LEFT JOIN descripciones d ON d.id = m.descripcion_id
      WHERE m.deleted_at IS NULL AND m.tipo = 'egreso'
        AND (LOWER(m.concepto) LIKE '%adelant%' OR LOWER(m.comentarios) LIKE '%adelant%'
             OR LOWER(d.nombre) LIKE '%adelant%')
      ORDER BY m.id
    `)
    const pagos = pagosRows as PagoAuditoria[]
    const anteriores = solicitudes
      .filter(s => !s.circuito_nuevo)
      .map(s => {
        const detalles =
          typeof s.detalles === 'string' ? (JSON.parse(s.detalles) as Record<string, unknown>) : (s.detalles ?? {})
        const nombre = s.personal_nombre ? normalizar(s.personal_nombre) : ''
        const monto = Number(detalles.monto)
        // Nombre e importe coincidentes sugieren un candidato; requieren revisión, no son prueba de pago.
        const candidatos =
          nombre && Number.isFinite(monto)
            ? pagos.filter(
                p =>
                  normalizar(`${p.concepto} ${p.comentarios ?? ''}`).includes(nombre) &&
                  Math.round(Math.abs(Number(p.monto)) * 100) === Math.round(monto * 100),
              )
            : []
        return {
          solicitud_id: s.id,
          personal_id: s.personal_id,
          estado_rrhh: s.estado,
          fecha: s.fecha,
          monto_solicitado: monto,
          candidatos_tesoreria: candidatos.map(p => ({
            movimiento_id: p.id,
            estado: p.estado,
            fecha: p.fecha,
            monto: Math.abs(Number(p.monto)),
          })),
          requiere_revision: true,
        }
      })
    process.stdout.write(
      JSON.stringify(
        {
          base_revisada: process.env.DB_DATABASE,
          revisado_en: new Date().toISOString(),
          solicitudes_total: solicitudes.length,
          solicitudes_circuito_nuevo: solicitudes.filter(s => s.circuito_nuevo).length,
          solicitudes_anteriores: anteriores,
          pagos_con_referencia_a_adelantos: pagos.map(p => ({
            movimiento_id: p.id,
            estado: p.estado,
            fecha: p.fecha,
            monto: Math.abs(Number(p.monto)),
          })),
          cambios_realizados: 0,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await connection.end()
  }
}

auditar().catch((err: unknown) => {
  process.stderr.write(
    err instanceof Error && 'code' in err
      ? `No se pudo revisar la base (${String(err.code)}).\n`
      : 'No se pudo completar la revisión de adelantos.\n',
  )
  process.exitCode = 1
})
