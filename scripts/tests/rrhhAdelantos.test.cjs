// Ejecutar con Node 22+: pnpm exec tsx --test scripts/tests/rrhhAdelantos.test.cjs
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { DatabaseSync } = require('node:sqlite')
const { estadoPagoAprobado } = require('../../src/services/estadoPagoService.ts')

test('la aprobación respeta completado, mantiene proyectados y rechaza estados inválidos', () => {
  assert.equal(estadoPagoAprobado(undefined), 'aprobado')
  assert.equal(estadoPagoAprobado('aprobado'), 'aprobado')
  assert.equal(estadoPagoAprobado('completado'), 'completado')
  for (const estado of ['pendiente', 'rechazado', '', null, 1]) assert.equal(estadoPagoAprobado(estado), null)
})
const {
  ADELANTO_FECHA_SQL,
  ADELANTO_INCORPORADO_SQL,
  ADELANTO_PAGOS_JOIN_SQL,
  ADELANTO_PAGO_COLUMNS_SQL,
  crearPagoAdelanto,
  detallesAdelantoPagado,
  registrarCircuitoAdelanto,
  separarPagoAdelanto,
} = require('../../src/services/rrhhAdelantosService.ts')

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE rrhh_solicitudes (id INTEGER PRIMARY KEY, tipo TEXT, estado TEXT, fecha_solicitud TEXT);
    CREATE TABLE movimientos (
      id INTEGER PRIMARY KEY, sucursal_id INTEGER, user_id INTEGER, fecha TEXT,
      concepto TEXT, comentarios TEXT, monto REAL, tipo_movimiento TEXT, saldo TEXT,
      prioridad TEXT, estado TEXT, tipo TEXT, moneda TEXT, deleted_at TEXT
    );
    CREATE TABLE rrhh_adelantos_pagos (
      solicitud_id INTEGER PRIMARY KEY, movimiento_id INTEGER UNIQUE,
      FOREIGN KEY(solicitud_id) REFERENCES rrhh_solicitudes(id),
      FOREIGN KEY(movimiento_id) REFERENCES movimientos(id)
    );
    INSERT INTO rrhh_solicitudes VALUES (1, 'Adelantos', 'Pendiente', '2026-09-17');
  `)
  db.function('DATE_FORMAT', (value, format) => {
    assert.equal(format, '%Y-%m-%d')
    return value
  })
  db.function('MONTH', value => Number(String(value).slice(5, 7)))
  db.function('YEAR', value => Number(String(value).slice(0, 4)))

  // SQLite ejecuta el SQL de las consultas; sólo se adaptan el upsert y el bloqueo de MySQL.
  const execute = async (sql, params = []) => {
    const adapted = sql
      .replace('FOR UPDATE', '')
      .replace('ON DUPLICATE KEY UPDATE solicitud_id = VALUES(solicitud_id)', 'ON CONFLICT(solicitud_id) DO NOTHING')
    const statement = db.prepare(adapted)
    if (/^\s*SELECT/i.test(adapted)) return [statement.all(...params)]
    const result = statement.run(...params)
    return [{ insertId: Number(result.lastInsertRowid), affectedRows: Number(result.changes) }]
  }
  const connection = { execute }
  const solicitud = {
    id: 1,
    personal_id: 37,
    sucursal_id: 18,
    usuario_id: 9,
    personal_nombre: 'Prueba',
    legajo: '000037',
  }
  const detalles = { monto: 1000, fecha: '2026-09-17', motivo: 'Adelanto solicitado' }
  const base = `FROM rrhh_solicitudes s ${ADELANTO_PAGOS_JOIN_SQL}`
  const incorporados = () =>
    db.prepare(`SELECT s.id ${base} WHERE s.estado = 'Aprobada' AND ${ADELANTO_INCORPORADO_SQL}`).all()
  const pago = () => db.prepare(`SELECT ${ADELANTO_PAGO_COLUMNS_SQL} ${base} WHERE s.id = 1`).get()
  return { db, execute, connection, solicitud, detalles, base, incorporados, pago }
}

test('pendiente RRHH → pendiente Tesorería → proyectado → completado', async () => {
  const f = fixture()
  try {
    await registrarCircuitoAdelanto(f.connection, 1)
    assert.equal(f.incorporados().length, 0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM movimientos').get()?.n, 0)

    f.db.exec('BEGIN')
    const movimientoId = await crearPagoAdelanto(f.connection, f.solicitud, f.detalles)
    f.db.exec("UPDATE rrhh_solicitudes SET estado = 'Aprobada' WHERE id = 1; COMMIT")
    const pendiente = f.db.prepare('SELECT * FROM movimientos WHERE id = ?').get(movimientoId)
    assert.equal(pendiente?.estado, 'pendiente')
    assert.equal(pendiente?.saldo, 'saldo_necesario')
    assert.equal(pendiente?.monto, -1000)
    assert.equal(pendiente?.tipo, 'egreso')
    assert.equal(pendiente?.user_id, 9)
    assert.equal(f.incorporados().length, 0)
    assert.equal(separarPagoAdelanto(f.pago()).pago_tesoreria?.estado, 'pendiente')

    f.db.prepare("UPDATE movimientos SET estado = 'aprobado', saldo = 'saldo_necesario' WHERE id = ?").run(movimientoId)
    assert.equal(f.incorporados().length, 0)
    assert.deepEqual(detallesAdelantoPagado(f.detalles, f.pago()), f.detalles)

    f.db
      .prepare(
        "UPDATE movimientos SET estado = 'completado', saldo = 'saldo_real', monto = -800, fecha = '2026-10-02' WHERE id = ?",
      )
      .run(movimientoId)
    assert.equal(f.incorporados().length, 1)
    assert.deepEqual(detallesAdelantoPagado(f.detalles, f.pago()), { ...f.detalles, monto: 800, fecha: '2026-10-02' })
    const porPeriodo = f.db.prepare(
      `SELECT s.id ${f.base} WHERE ${ADELANTO_INCORPORADO_SQL} AND MONTH(${ADELANTO_FECHA_SQL}) = ? AND YEAR(${ADELANTO_FECHA_SQL}) = ?`,
    )
    assert.equal(porPeriodo.all(9, 2026).length, 0)
    assert.equal(porPeriodo.all(10, 2026).length, 1)

    assert.equal(await crearPagoAdelanto(f.connection, f.solicitud, f.detalles), movimientoId)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM movimientos').get()?.n, 1)
  } finally {
    f.db.close()
  }
})

test('rechazados, eliminados o devueltos a proyectado no se incorporan', async () => {
  const f = fixture()
  try {
    const id = await crearPagoAdelanto(f.connection, f.solicitud, f.detalles)
    f.db.exec("UPDATE rrhh_solicitudes SET estado = 'Aprobada' WHERE id = 1")
    f.db.prepare("UPDATE movimientos SET estado = 'rechazado' WHERE id = ?").run(id)
    assert.equal(f.incorporados().length, 0)
    f.db.prepare("UPDATE movimientos SET estado = 'completado', deleted_at = '2026-09-18' WHERE id = ?").run(id)
    assert.equal(f.incorporados().length, 0)
    assert.equal(separarPagoAdelanto(f.pago()).pago_tesoreria?.eliminado, true)
    f.db.prepare("UPDATE movimientos SET estado = 'aprobado', deleted_at = NULL WHERE id = ?").run(id)
    assert.equal(f.incorporados().length, 0)
  } finally {
    f.db.close()
  }
})

test('histórico sin migrar y otras solicitudes conservan su comportamiento', async () => {
  const f = fixture()
  try {
    f.db.exec(`
      UPDATE rrhh_solicitudes SET estado = 'Aprobada' WHERE id = 1;
      INSERT INTO rrhh_solicitudes VALUES (2, 'Licencias', 'Aprobada', '2026-09-17');
    `)
    assert.equal(f.incorporados().length, 2)
    assert.equal(separarPagoAdelanto(f.pago()).pago_tesoreria, null)
    assert.deepEqual(detallesAdelantoPagado(f.detalles, f.pago()), f.detalles)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM movimientos').get()?.n, 0)
  } finally {
    f.db.close()
  }
})

test('un fallo al vincular el pago revierte el movimiento con la transacción RRHH', async () => {
  const f = fixture()
  try {
    await registrarCircuitoAdelanto(f.connection, 1)
    const connection = {
      execute: async (sql, params) => {
        if (sql.startsWith('UPDATE rrhh_adelantos_pagos')) throw new Error('fallo simulado')
        return f.execute(sql, params)
      },
    }
    f.db.exec('BEGIN')
    await assert.rejects(crearPagoAdelanto(connection, f.solicitud, f.detalles), /fallo simulado/)
    f.db.exec('ROLLBACK')
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM movimientos').get()?.n, 0)
    assert.equal(f.pago().adelanto_movimiento_id, null)
  } finally {
    f.db.close()
  }
})
