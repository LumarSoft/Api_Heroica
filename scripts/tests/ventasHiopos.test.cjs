// Ejecutar con Node 22+: pnpm exec tsx --test scripts/tests/ventasHiopos.test.cjs
// Prueba la integración con Hiopos contra un Bridge simulado que reproduce las trampas
// documentadas en el "Manual del Bridge ICG" (XML con HTTP 200 en errores, Base64,
// comas de miles, body de 0 bytes, 401 con token muerto). No usa la base de datos.
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { test, before, after } = require('node:test')

// Con VENTAS_TEST_BUILD=<dir> usa el código compilado por tsc (sin tsx).
const src = modulo =>
  process.env.VENTAS_TEST_BUILD
    ? require(path.join(process.env.VENTAS_TEST_BUILD, `${modulo}.js`))
    : require(`../../src/${modulo}.ts`)

const { sanitizarMiles, parsearJsonExport, aFilas, parsearCsv, decodificarDocumentos } = src(
  'services/ventas/hioposDecoder',
)
const { normalizarFilasHiopos, numero, fechaYHora, aEpochMs } = src('services/ventas/hioposNormalizer')
const { HioposSesion, HioposError, interpretarLogin, cifrarParaErp } = src('services/ventas/hioposClient')
const crypto = require('node:crypto')
const { detectarMapeo, validarMapeo, detectarFiltroFechaModificado } = src('services/ventas/hioposMapeo')

// ─── Bridge simulado ──────────────────────────────────────────────────────────

const EXPORT_ID = '11111111-2222-3333-4444-555555555555'
const ATTR_FECHA_MOD = 12331
let servidor
let base
const tokensVivos = new Set()
const llamadas = []

const filasEjemplo = [
  {
    Serie: 'T001',
    Número: 2553,
    Fecha: '2026-10-07',
    Hora: '09:15:02',
    'Cod. Almacén': 'A1',
    Almacén: 'HEROICA GUEMES',
    Referencia: 'CAF01',
    Artículo: 'Café con leche',
    Familia: 'Cafetería',
    Unidades: 2,
    Precio: 2500,
    Importe: 5000,
    'Forma de pago': 'Efectivo',
    Vendedor: 'Ana',
    Caja: 'Caja 1',
    GUID: 'g-1',
    UpdateVersion: '1791457000000',
  },
  {
    Serie: 'T001',
    Número: 2553,
    Fecha: '2026-10-07',
    Hora: '09:15:02',
    'Cod. Almacén': 'A1',
    Almacén: 'HEROICA GUEMES',
    Referencia: 'MED01',
    Artículo: 'Medialuna',
    Familia: 'Panadería',
    Unidades: 3,
    Precio: 900,
    Importe: 2700,
    'Forma de pago': 'Efectivo',
    Vendedor: 'Ana',
    Caja: 'Caja 1',
    GUID: 'g-1',
    UpdateVersion: '1791457000000',
  },
  {
    Serie: 'T002',
    Número: 10,
    Fecha: '2026-10-07',
    Hora: '21:40:00',
    'Cod. Almacén': 'A2',
    Almacén: 'HEROICA CENTRO',
    Referencia: 'TOR01',
    Artículo: 'Torta entera',
    Familia: 'Pastelería',
    Unidades: 1,
    Precio: '43,500.00',
    Importe: '43,500.00',
    'Forma de pago': 'Tarjeta',
    Vendedor: 'Luis',
    Caja: 'Caja 2',
    GUID: 'g-2',
    UpdateVersion: '1791499000000',
  },
]

function jsonConMiles(filas) {
  // ICG emite los números grandes con coma de miles y sin comillas.
  return JSON.stringify(filas).replace(/"(\d{1,3}(?:,\d{3})+\.\d+)"/g, '$1')
}

before(async () => {
  servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      llamadas.push(`${req.method} ${url.pathname}`)
      if (url.pathname === '/services/cloud/getCustomerServer3') {
        const { port } = servidor.address()
        res.end(
          url.searchParams.get('email') === '95368'
            ? `<response><customerFTPResponse><address>127.0.0.1</address><bridgeExportation>false</bridgeExportation><customerId>95368</customerId><port>${port}</port><secure>false</secure></customerFTPResponse></response>`
            : '<response><serverError><code>13</code><message>Not found</message></serverError></response>',
        )
        return
      }
      if (url.pathname === '/ErpCloud/session/login') {
        const descifrar = v => {
          const d = crypto.createDecipheriv(
            'aes-128-cbc',
            Buffer.from('B1B2B3B4B5B6B7B8'),
            Buffer.from('B1B2B3B4B5B6B7B8'),
          )
          return Buffer.concat([
            d.update(Buffer.from(v.split('-666666-').join('+').split('-999999-').join('/'), 'base64')),
            d.final(),
          ]).toString()
        }
        if (
          url.searchParams.get('encrypted') !== 'true' ||
          descifrar(url.searchParams.get('password')) !== 'correcta' ||
          url.searchParams.get('customerId') !== '95368'
        ) {
          res.statusCode = 401
          res.end('{"message":"Usuario o contraseña incorrectos"}')
          return
        }
        const token = `erp-${Date.now()}`
        tokensVivos.add(token)
        res.setHeader('x-auth-token', token)
        res.end('{}')
        return
      }
      if (url.pathname === '/services/cloud/getCustomerWithAuthToken') {
        res.setHeader('Content-Type', 'application/xml')
        if (url.searchParams.get('password') !== 'correcta') {
          // Trampa 1: credenciales inválidas = HTTP 200 + serverError.
          res.end(
            '<response><customerWithAuthTokenResponse><serverError><code>6</code></serverError></customerWithAuthTokenResponse></response>',
          )
          return
        }
        const token = `tok-${tokensVivos.size + 1}-${Date.now()}`
        tokensVivos.add(token)
        const { port } = servidor.address()
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><response><customerWithAuthTokenResponse><address>127.0.0.1</address><authToken>${token}</authToken><customerId>99999</customerId><port>${port}</port><secure>false</secure></customerWithAuthTokenResponse></response>`,
        )
        return
      }
      const token = req.headers['x-auth-token']
      if (!tokensVivos.has(token)) {
        res.statusCode = 401
        res.end('{"message":"Authentication failed"}')
        return
      }
      if (url.pathname === '/ErpCloud/session/logout') {
        tokensVivos.delete(token)
        res.statusCode = 204
        res.end()
        return
      }
      if (url.pathname === `/ErpCloud/exportation/getExportationDashboardFilters/${EXPORT_ID}`) {
        res.end(
          JSON.stringify([
            { attributeId: 31, arithmeticOperator: 'EQUAL', type: 'Integer' },
            { attributeId: ATTR_FECHA_MOD, arithmeticOperator: 'BETWEEN', type: 'Datetime' },
            { attributeId: 12069, arithmeticOperator: 'EQUAL', type: 'String' },
          ]),
        )
        return
      }
      if (url.pathname === '/ErpCloud/exportation/launch') {
        const pedido = JSON.parse(body)
        if (pedido.exportationId !== EXPORT_ID) {
          res.statusCode = 404
          res.end()
          return
        }
        if ((pedido.filters ?? []).some(f => ![31, ATTR_FECHA_MOD, 12069].includes(f.attributeId))) {
          res.end('') // Trampa: attributeId inexistente = 200 con 0 bytes.
          return
        }
        if (!pedido.startDate) {
          res.end('[]')
          return
        }
        let filas = filasEjemplo.filter(
          f => f.Fecha >= pedido.startDate && (!pedido.endDate || f.Fecha <= pedido.endDate),
        )
        const fechaMod = (pedido.filters ?? []).find(f => f.attributeId === ATTR_FECHA_MOD)
        if (fechaMod)
          filas = filas.filter(
            f =>
              Number(f.UpdateVersion) >= Number(fechaMod.value) && Number(f.UpdateVersion) <= Number(fechaMod.value2),
          )
        const data = Buffer.from(jsonConMiles(filas)).toString('base64')
        res.end(
          JSON.stringify([
            {
              exportedDocs: [
                { name: 'Ventas.pdf', data: 'JVBERi0=', type: 2 },
                { name: 'Ventas.json', data, type: 4 },
              ],
            },
          ]),
        )
        return
      }
      res.statusCode = 404
      res.end()
    })
  })
  await new Promise(r => servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${servidor.address().port}`
  process.env.HIOPOS_CLOUDLICENSE_URL = base
  process.env.HIOPOS_EMAIL = 'demo@heroica.test'
  process.env.HIOPOS_PASSWORD = 'correcta'
})

after(() => servidor.close())

// ─── Decodificación ───────────────────────────────────────────────────────────

test('sanea comas de miles fuera de strings y respeta los strings', () => {
  const crudo = '[{"Total": 43,500.06, "Neg": -1,234, "Texto": "1,234 y 5,000", "Ok": 12.5}]'
  assert.throws(() => JSON.parse(crudo))
  const [fila] = parsearJsonExport(crudo)
  assert.equal(fila.Total, 43500.06)
  assert.equal(fila.Neg, -1234)
  assert.equal(fila.Texto, '1,234 y 5,000')
  assert.equal(fila.Ok, 12.5)
  assert.equal(sanitizarMiles('{"a":[1,234]}'), '{"a":[1,234]}') // en arrays no se toca en modo seguro
})

test('convierte headers + rows (ExportationExecute) y CSV con ; a filas', () => {
  const filas = aFilas({
    headers: [{ name: 'Serie' }, { attributeName: 'Artículo' }, null],
    rows: [
      ['F1', 'Tortilla'],
      ['F2', 'Pan'],
    ],
  })
  assert.deepEqual(filas, [
    { Serie: 'F1', Artículo: 'Tortilla' },
    { Serie: 'F2', Artículo: 'Pan' },
  ])
  assert.deepEqual(parsearCsv('Serie;Artículo\r\nF1;"Peña; Muñoz"\r\n'), [{ Serie: 'F1', Artículo: 'Peña; Muñoz' }])
  const doc = { name: 'x.json', type: 4, data: Buffer.from('﻿[{"a":1}]').toString('base64') }
  assert.deepEqual(decodificarDocumentos([doc]).filas, [{ a: 1 }])
})

test('números y fechas en todos los formatos esperables', () => {
  assert.equal(numero('1,234.50'), 1234.5)
  assert.equal(numero('1.234,50'), 1234.5)
  assert.equal(numero('$ 2.500'), 2.5) // un solo punto = decimal (formato ICG)
  assert.equal(numero('12,5'), 12.5)
  assert.equal(numero('1,500'), 1500)
  assert.equal(numero('(100,00)'), -100)
  assert.deepEqual(fechaYHora('07/10/2026 9:05'), { fecha: '2026-10-07', hora: '09:05:00' })
  assert.deepEqual(fechaYHora('2026-10-07T21:40:00'), { fecha: '2026-10-07', hora: '21:40:00' })
  assert.deepEqual(fechaYHora('Mon Jul 11 00:00:00 CEST 2016'), { fecha: '2016-07-11', hora: '00:00:00' })
  // Epoch ms → hora Argentina (UTC-3): 2026-07-07 00:00 UTC = 2026-07-06 21:00 AR
  assert.deepEqual(fechaYHora('1783382400000'), { fecha: '2026-07-06', hora: '21:00:00' })
  assert.equal(aEpochMs('1784587665074'), 1784587665074)
})

// ─── Mapeo y normalización ────────────────────────────────────────────────────

test('detecta el mapeo por nombre de columna de HiOffice', () => {
  const mapeo = detectarMapeo(Object.keys(filasEjemplo[0]))
  assert.equal(mapeo.fecha, 'Fecha')
  assert.equal(mapeo.importe, 'Importe')
  assert.equal(mapeo.numero, 'Número')
  assert.equal(mapeo.documentoGuid, 'GUID')
  assert.equal(mapeo.localCodigo, 'Cod. Almacén')
  assert.equal(mapeo.localNombre, 'Almacén')
  assert.equal(mapeo.productoNombre, 'Artículo')
  assert.equal(mapeo.productoCodigo, 'Referencia')
  assert.equal(mapeo.categoria, 'Familia')
  assert.equal(mapeo.medioPago, 'Forma de pago')
  assert.equal(mapeo.fechaModificado, 'UpdateVersion')
  assert.deepEqual(validarMapeo(mapeo), [])
  assert.equal(validarMapeo({ importe: 'x' }).length, 2)
})

test('normaliza líneas, agrega un encabezado de pago por ticket y propaga anulaciones', () => {
  const mapeo = detectarMapeo(Object.keys(filasEjemplo[0]))
  mapeo.estado = 'Estado'
  const filas = [
    ...filasEjemplo.map(f => ({ ...f, Importe: numero(f.Importe) })),
    { ...filasEjemplo[0], GUID: 'g-3', Número: 99, Estado: 'Anulado' },
  ]
  const { lineas, rechazadas, documentos } = normalizarFilasHiopos([...filas, { Fecha: '', Importe: 1 }], mapeo)
  assert.equal(documentos, 3)
  assert.equal(rechazadas.length, 1)
  const pagos = lineas.filter(l => l.tipoLinea === 'pago')
  assert.equal(pagos.length, 3)
  const ticket1 = pagos.find(p => p.transaccionId === 'g-1')
  assert.equal(ticket1.importe, 7700)
  assert.equal(ticket1.medioPago, 'Efectivo')
  assert.equal(ticket1.documento, 'T001-2553')
  assert.equal(ticket1.fechaHora, '2026-10-07 09:15:02')
  assert.equal(pagos.find(p => p.transaccionId === 'g-2').importe, 43500)
  assert.ok(lineas.filter(l => l.transaccionId === 'g-3').every(l => l.anulada))
  assert.equal(lineas.find(l => l.productoNombre === 'Medialuna').cantidad, 3)
  assert.equal(lineas.find(l => l.productoNombre === 'Medialuna').vendedor, 'Ana')
})

test('sin GUID agrupa por local + serie-número + fecha', () => {
  const mapeo = {
    fecha: 'Fecha',
    importe: 'Importe',
    numero: 'Número',
    serie: 'Serie',
    localNombre: 'Almacén',
    medioPago: 'Pago',
  }
  const { lineas } = normalizarFilasHiopos(
    [
      { Fecha: '2026-10-07', Importe: 10, Número: 1, Serie: 'A', Almacén: 'L1', Pago: 'Efectivo' },
      { Fecha: '2026-10-07', Importe: 5, Número: 1, Serie: 'A', Almacén: 'L1', Pago: 'Tarjeta' },
      { Fecha: '2026-10-07', Importe: 7, Número: 1, Serie: 'A', Almacén: 'L2', Pago: 'Efectivo' },
    ],
    mapeo,
  )
  const pagos = lineas.filter(l => l.tipoLinea === 'pago')
  assert.equal(pagos.length, 2)
  assert.equal(pagos.find(p => p.localNombre === 'L1').medioPago, 'Efectivo + Tarjeta')
})

// ─── Cliente del Bridge ───────────────────────────────────────────────────────

test('login: XML envuelto en <response>, error con HTTP 200 y servidor dinámico', async () => {
  const datos = interpretarLogin(
    '<response><customerWithAuthTokenResponse><address>argentina9.hiopos.com</address><authToken>t</authToken><port>443</port><secure>true</secure></customerWithAuthTokenResponse></response>',
  )
  assert.equal(datos.baseUrl, 'https://argentina9.hiopos.com')
  assert.throws(
    () => interpretarLogin('<response><serverError><code>6</code></serverError></response>'),
    e => e instanceof HioposError && e.tipo === 'credenciales',
  )

  process.env.HIOPOS_PASSWORD = 'mala'
  await assert.rejects(new HioposSesion().login(), e => e.tipo === 'credenciales')
  process.env.HIOPOS_PASSWORD = 'correcta'
})

test('filtros, launch con Base64 + comas de miles, 0 bytes y re-login ante 401', async () => {
  const sesion = new HioposSesion()
  try {
    const filtros = await sesion.obtenerFiltros(EXPORT_ID)
    assert.equal(filtros.length, 3)
    assert.equal(detectarFiltroFechaModificado(filtros), ATTR_FECHA_MOD)

    const r = await sesion.launch({
      exportationId: EXPORT_ID,
      startDate: '2026-10-07',
      endDate: '2026-10-08',
      filters: [],
    })
    assert.equal(r.bodyVacio, false)
    const { filas, formato } = decodificarDocumentos(r.documentos)
    assert.equal(formato, 'json')
    assert.equal(filas.length, 3)
    assert.equal(filas[2].Importe, 43500)

    const vacio = await sesion.launch({
      exportationId: EXPORT_ID,
      startDate: '2026-10-07',
      filters: [{ attributeId: 999, arithmeticOperator: 'EQUAL', type: 'String', value: 'x' }],
    })
    assert.equal(vacio.bodyVacio, true)

    const conMod = await sesion.launch({
      exportationId: EXPORT_ID,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      filters: [
        {
          attributeId: ATTR_FECHA_MOD,
          arithmeticOperator: 'BETWEEN',
          type: 'Datetime',
          value: '1791480000000',
          value2: '1791500000000',
        },
      ],
    })
    assert.equal(decodificarDocumentos(conMod.documentos).filas.length, 1)

    // Token muerto (ej. expiró por inactividad): la sesión se re-loguea sola y reintenta.
    tokensVivos.clear()
    const otra = await sesion.launch({ exportationId: EXPORT_ID, startDate: '2026-10-07', endDate: '2026-10-08' })
    assert.equal(decodificarDocumentos(otra.documentos).filas.length, 3)
  } finally {
    await sesion.cerrar()
  }
  assert.equal(tokensVivos.size, 0, 'el logout cierra la sesión')
  assert.ok(llamadas.includes('GET /ErpCloud/session/logout'))
})

test('exportationId inexistente → error de configuración', async () => {
  const sesion = new HioposSesion()
  try {
    await assert.rejects(
      sesion.launch({ exportationId: 'no-existe', startDate: '2026-10-07' }),
      e => e.tipo === 'configuracion',
    )
  } finally {
    await sesion.cerrar()
  }
})

test('login como usuario de HiOffice + empresa (como la web) y aviso de licencia de Bridge', async () => {
  assert.ok(!cifrarParaErp('a+b/c?').includes('+') && !cifrarParaErp('a+b/c?').includes('/'))
  process.env.HIOPOS_CUSTOMER_ID = '95368'
  const sesion = new HioposSesion()
  try {
    const datos = await sesion.login()
    assert.ok(datos.token.startsWith('erp-'))
    assert.equal(sesion.servidorCliente.bridgeExportation, false)
    const r = await sesion.launch({ exportationId: EXPORT_ID, startDate: '2026-10-07', endDate: '2026-10-08' })
    assert.equal(decodificarDocumentos(r.documentos).filas.length, 3)
    process.env.HIOPOS_PASSWORD = 'mala'
    await assert.rejects(new HioposSesion().login(), e => e.tipo === 'credenciales')
    process.env.HIOPOS_CUSTOMER_ID = '1'
    process.env.HIOPOS_PASSWORD = 'correcta'
    await assert.rejects(new HioposSesion().login(), e => /no encuentra la empresa/.test(e.message))
  } finally {
    delete process.env.HIOPOS_CUSTOMER_ID
    await sesion.cerrar()
  }
})

// ─── Bistrosoft (convive con Hiopos) ──────────────────────────────────────────

test('Bistrosoft: propaga la anulación del ticket, día operativo y sin datos de clientes', () => {
  const { normalizarItemsBistrosoft } = src('services/ventas/bistrosoftNormalizer')
  const base = { uuid: 'u1', ticketNumber: 7, shopCode: '11112935', shop: 'HEROICA CORDOBA SHOPPING' }
  const items = [
    {
      ...base,
      transactionType: 'Venta',
      amount: 3000,
      paymentMethod: 'Efectivo',
      status: 'VOID',
      timestamp: '2026-10-08T01:30:00',
      waiter: 'Caro',
      client: 'Juan',
    },
    {
      ...base,
      transactionType: '- ITEM',
      amount: 3000,
      quantity: 1,
      sku: 'X1',
      product: 'Torta',
      category: 'Pastelería',
      timestamp: '2026-10-08T01:30:00',
    },
    {
      transactionType: 'CAJA (Apertura)',
      amount: 1000,
      ticketNumber: 0,
      shopCode: '11112935',
      timestamp: '2026-10-07T08:00:00',
    },
    { ...base, transactionType: '- ITEM' },
  ]
  const r = normalizarItemsBistrosoft(items, '2026-10-07')
  assert.equal(r.filter(x => x.ok).length, 3)
  assert.equal(r[3].ok, false)
  const [pago, producto, caja] = r.map(x => x.linea)
  assert.equal(pago.anulada, true)
  assert.equal(producto.anulada, true, 'la anulación del encabezado se propaga')
  assert.equal(pago.fecha, '2026-10-07', 'una venta de la madrugada es del día operativo consultado')
  assert.equal(pago.documento, '7')
  assert.equal(pago.vendedor, 'Caro')
  assert.equal(pago.tipoLinea, 'pago')
  assert.equal(producto.cantidad, 1)
  assert.equal(caja.tipoLinea, 'caja')
  assert.ok(!('client' in pago.raw))
})
