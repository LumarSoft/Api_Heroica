import { Request, Response } from 'express'
import multer from 'multer'
import { query, getConnection } from '../config/database'
import { verificarAccesoSucursal, normalizarFecha } from '../utils/movimientosHelpers'
import { construirPreview } from '../services/importacionBancaria/agrupador'
import {
  cargarCatalogos,
  mensajeFaltantes,
  resolverDestino,
  validarReglas,
} from '../services/importacionBancaria/catalogoResolver'
import { detectarAdapter, listarAdapters, obtenerAdapter } from '../services/importacionBancaria/registry'
import { ErrorDeFormato, FilaNormalizada, PreviewImportacion } from '../services/importacionBancaria/types'
import { hashearFilas, sha256 } from '../services/importacionBancaria/utils'
import { cargarWorkbook } from '../services/importacionBancaria/xlsxCompat'

/**
 * ============================================================
 *  CONTROLLER — IMPORTACIÓN MASIVA DE EXTRACTOS BANCARIOS
 * ============================================================
 *
 * Flujo en dos pasos, a propósito:
 *
 *   1. POST /preview   → lee el archivo y devuelve QUÉ se va a crear, qué se
 *                        ignora y por qué. No escribe nada.
 *   2. POST /confirmar → recibe el mismo archivo y lo impacta en la caja,
 *                        dentro de una transacción.
 *
 * El paso 2 vuelve a parsear el archivo en vez de confiar en un preview
 * guardado en memoria o en el cliente. Es más trabajo, pero elimina toda una
 * familia de bugs: previews vencidos, dos usuarios importando a la vez, o un
 * front manipulado mandando montos que el servidor nunca calculó.
 *
 * `archivo_hash` viaja del preview a la confirmación y se verifica: si no
 * coincide, es que se subió un archivo distinto al que se revisó.
 */

const MAX_BYTES = 15 * 1024 * 1024

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const permitidos = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // algunos navegadores mandan esto para .xlsx
      'application/octet-stream',
    ]
    const extensionOk = /\.xlsx$/i.test(file.originalname)

    if (!extensionOk) {
      return cb(
        new Error(
          'Solo se aceptan archivos .xlsx. Si el banco te lo dio en otro formato, ' +
            'abrilo y exportalo como Excel (.xlsx) antes de subirlo.',
        ),
      )
    }
    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error(`Tipo de archivo no reconocido (${file.mimetype}). Se esperaba un .xlsx.`))
    }
    cb(null, true)
  },
})

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

interface ContextoImportacion {
  preview: PreviewImportacion
  adapterClave: string
  nombreArchivo: string
  buffer: Buffer
  /**
   * Índice hash → fila original del extracto. Se arma acá porque al confirmar
   * hay que guardar el detalle de cada fila, y el preview solo lleva los hashes.
   * `hashearFilas` es determinístico, así que recalcularlo da exactamente los
   * mismos hashes que usó el agrupador.
   */
  filasPorHash: Map<string, FilaNormalizada>
}

/**
 * Tronco común de preview y confirmar: valida acceso, parsea el archivo, valida
 * las reglas contra los catálogos y arma el preview. Devuelve `null` si ya
 * respondió con un error (para que el caller corte).
 */
async function prepararImportacion(req: Request, res: Response): Promise<ContextoImportacion | null> {
  const sucursalId = Number(req.body.sucursal_id)
  const bancoIdManual = Number(req.body.banco_id) || null
  const adapterClave = (req.body.adapter as string) || ''

  if (!sucursalId) {
    res.status(400).json({ success: false, message: 'Falta el campo requerido: sucursal_id.' })
    return null
  }
  if (!req.file) {
    res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' })
    return null
  }
  if (!(await verificarAccesoSucursal(req.user!, sucursalId))) {
    res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal.' })
    return null
  }

  const buffer = req.file.buffer
  const nombreArchivo = req.file.originalname

  let workbook
  let fechasReparadas = 0
  try {
    const cargado = await cargarWorkbook(buffer)
    workbook = cargado.workbook
    fechasReparadas = cargado.fechasReparadas
  } catch {
    res.status(400).json({
      success: false,
      message: 'No se pudo leer el archivo. Verificá que sea un .xlsx válido y que no esté dañado.',
    })
    return null
  }

  // El usuario puede elegir el banco explícitamente; si no, se autodetecta.
  const adapter = adapterClave ? obtenerAdapter(adapterClave) : detectarAdapter(workbook, nombreArchivo)
  if (!adapter) {
    res.status(400).json({
      success: false,
      message:
        'No se pudo reconocer el formato del extracto. Elegí el banco manualmente ' +
        `o verificá que el archivo sea el que exporta el home banking. Bancos disponibles: ` +
        `${listarAdapters()
          .map(a => a.nombre)
          .join(', ')}.`,
    })
    return null
  }

  // El banco se deduce del archivo: el usuario no tiene que elegirlo. Si vino
  // explícito en el request (por compatibilidad) se respeta.
  let bancoId: number
  if (bancoIdManual) {
    const existe: any = await query('SELECT id FROM bancos WHERE id = ? AND deleted_at IS NULL', [bancoIdManual])
    if (!existe.length) {
      res.status(400).json({ success: false, message: 'El banco indicado no existe.' })
      return null
    }
    bancoId = bancoIdManual
  } else {
    const resuelto = await resolverBancoDeAdapter(adapter)
    if ('error' in resuelto) {
      res.status(422).json({ success: false, message: resuelto.error })
      return null
    }
    bancoId = resuelto.id
  }

  // Las reglas se validan contra los catálogos ANTES de parsear en serio: si
  // falta una subcategoría, no tiene sentido procesar 4.000 filas.
  let catalogos
  try {
    catalogos = await cargarCatalogos()
  } catch (error) {
    console.error('Error al cargar catálogos para la importación:', error)
    res.status(500).json({
      success: false,
      message:
        'No se pudieron leer los catálogos del sistema (categorías, subcategorías, ' +
        'descripciones, medios de pago o proveedores). Es un problema de base de datos, ' +
        'no del archivo. Revisá el log del servidor.',
    })
    return null
  }

  const faltantes = validarReglas(adapter.reglas, catalogos)
  if (faltantes.length > 0) {
    res.status(422).json({ success: false, message: mensajeFaltantes(faltantes), faltantes })
    return null
  }

  let parse
  try {
    parse = adapter.parse(workbook, nombreArchivo)
  } catch (error) {
    if (error instanceof ErrorDeFormato) {
      res.status(400).json({ success: false, message: error.message })
      return null
    }
    throw error
  }

  if (fechasReparadas > 0) {
    parse.advertencias.push(
      `Se corrigieron ${fechasReparadas} celdas de fecha con formato ISO (particularidad del archivo de este banco).`,
    )
  }

  // Hashes ya importados de esta sucursal + banco, acotados al rango del archivo
  // para no traer el histórico entero.
  const fechas = parse.filas.map(f => f.fecha).sort()
  const existentes: any = await query(
    `SELECT fila_hash FROM importaciones_bancarias_filas
     WHERE sucursal_id = ? AND banco_id = ? AND fecha BETWEEN ? AND ?`,
    [sucursalId, bancoId, fechas[0], fechas[fechas.length - 1]],
  )

  const preview = construirPreview({
    parse,
    reglas: adapter.reglas,
    hashesExistentes: new Set(existentes.map((r: any) => r.fila_hash)),
    sucursalId,
    bancoId,
    archivoHash: sha256(buffer),
  })

  const hashes = hashearFilas(parse.filas)
  const filasPorHash = new Map<string, FilaNormalizada>()
  parse.filas.forEach((fila, i) => filasPorHash.set(hashes[i], fila))

  return { preview, adapterClave: adapter.clave, nombreArchivo, buffer, filasPorHash }
}

/**
 * Busca en la tabla `bancos` el registro que corresponde al adapter detectado,
 * usando los alias que declara el propio adapter. Así el usuario sube el archivo
 * y listo: no tiene que elegir el banco de una lista.
 *
 * Devuelve un mensaje accionable si no encuentra ninguno o si hay más de uno,
 * porque en ambos casos el arreglo es de configuración, no del archivo.
 */
async function resolverBancoDeAdapter(adapter: {
  nombre: string
  aliasesBanco: string[]
}): Promise<{ id: number } | { error: string }> {
  const normalizar = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()

  const bancos: any = await query('SELECT id, nombre FROM bancos WHERE deleted_at IS NULL')
  const alias = adapter.aliasesBanco.map(normalizar)

  const candidatos = bancos.filter((b: any) => {
    const nombre = normalizar(b.nombre)
    return alias.some(a => nombre.includes(a) || a.includes(nombre))
  })

  if (candidatos.length === 1) return { id: candidatos[0].id }

  if (candidatos.length === 0) {
    return {
      error:
        `El extracto es de ${adapter.nombre}, pero no hay ningún banco con ese nombre cargado en el sistema. ` +
        `Creálo en Configuración › Bancos y volvé a intentar.`,
    }
  }

  return {
    error:
      `Hay ${candidatos.length} bancos que coinciden con ${adapter.nombre} ` +
      `(${candidatos.map((b: any) => b.nombre).join(', ')}). ` +
      `Dejá uno solo en Configuración › Bancos para que la importación sepa a cuál cargar.`,
  }
}

// ─────────────────────────────────────────────────────────────
//  GET /api/importacion-bancaria/bancos
// ─────────────────────────────────────────────────────────────
export const getBancosSoportados = async (_req: Request, res: Response) => {
  res.json({ success: true, data: listarAdapters() })
}

// ─────────────────────────────────────────────────────────────
//  POST /api/importacion-bancaria/preview
// ─────────────────────────────────────────────────────────────
export const previewImportacion = async (req: Request, res: Response) => {
  try {
    const ctx = await prepararImportacion(req, res)
    if (!ctx) return

    res.json({ success: true, data: ctx.preview })
  } catch (error) {
    console.error('Error en preview de importación bancaria:', error)
    res.status(500).json({ success: false, message: 'Error al procesar el archivo.' })
  }
}

/** Cuántas filas de respaldo entran en cada INSERT múltiple. */
const LOTE_FILAS = 200

const COLUMNAS_FILA = 15

/**
 * Inserta las filas de respaldo agrupándolas en INSERT múltiples.
 * Ver el comentario en `confirmarImportacion` para el motivo.
 */
async function insertarFilasEnLotes(connection: any, filas: unknown[][]): Promise<void> {
  if (filas.length === 0) return

  const placeholdersFila = `(${Array(COLUMNAS_FILA).fill('?').join(', ')})`

  for (let i = 0; i < filas.length; i += LOTE_FILAS) {
    const lote = filas.slice(i, i + LOTE_FILAS)
    await connection.query(
      `INSERT INTO importaciones_bancarias_filas
       (importacion_id, movimiento_id, sucursal_id, banco_id, fila_hash, operacion_id, fecha,
        concepto_codigo, concepto_descripcion, grupo_codigo, descripcion_banco, monto, estado_banco, saldo_banco, raw)
       VALUES ${lote.map(() => placeholdersFila).join(', ')}`,
      lote.flat(),
    )
  }
}

// ─────────────────────────────────────────────────────────────
//  POST /api/importacion-bancaria/confirmar
// ─────────────────────────────────────────────────────────────
export const confirmarImportacion = async (req: Request, res: Response) => {
  const connection = await getConnection()

  try {
    const ctx = await prepararImportacion(req, res)
    if (!ctx) {
      connection.release()
      return
    }

    const { preview, adapterClave, nombreArchivo, filasPorHash } = ctx

    // Garantía de que se confirma exactamente lo que se revisó.
    const hashEsperado = req.body.archivo_hash as string | undefined
    if (hashEsperado && hashEsperado !== preview.archivoHash) {
      connection.release()
      return res.status(409).json({
        success: false,
        message: 'El archivo cambió respecto del que se previsualizó. Volvé a revisar antes de confirmar.',
      })
    }

    if (preview.conceptosSinRegla.length > 0) {
      connection.release()
      return res.status(422).json({
        success: false,
        message:
          `El extracto trae ${preview.conceptosSinRegla.length} concepto(s) que no están mapeados: ` +
          `${preview.conceptosSinRegla.map(c => `${c.codigo} (${c.conceptoDescripcion})`).join(', ')}. ` +
          `Hay que agregarlos a las reglas del banco antes de importar.`,
        conceptosSinRegla: preview.conceptosSinRegla,
      })
    }

    if (preview.movimientos.length === 0) {
      connection.release()
      return res.status(200).json({
        success: true,
        message: 'No hay movimientos nuevos para importar: el archivo ya estaba cargado por completo.',
        data: { importacion_id: null, movimientos_creados: 0, filas_omitidas: preview.filasOmitidas },
      })
    }

    // Guardarraíl contra el doble clic: si este mismo archivo ya se confirmó para
    // esta sucursal y banco, cortamos acá en vez de arrancar una transacción que
    // va a chocar contra el índice único a mitad de camino.
    const yaConfirmada: any = await query(
      `SELECT id, created_at FROM importaciones_bancarias
       WHERE sucursal_id = ? AND banco_id = ? AND archivo_hash = ? AND estado = 'confirmada'
       LIMIT 1`,
      [preview.sucursalId, preview.bancoId, preview.archivoHash],
    )
    if (yaConfirmada.length > 0) {
      connection.release()
      return res.status(409).json({
        success: false,
        message:
          `Este archivo ya se importó (importación #${yaConfirmada[0].id}). ` +
          `No se creó nada nuevo. Si necesitás rehacerla, revertí esa importación primero.`,
        data: { importacion_id: yaConfirmada[0].id },
      })
    }

    const catalogos = await cargarCatalogos()
    const userId = req.user!.id

    await connection.beginTransaction()

    // ── Cabecera ──────────────────────────────────────────────────────────────
    const [cabecera]: any = await connection.query(
      `INSERT INTO importaciones_bancarias
       (sucursal_id, banco_id, user_id, adapter, nombre_archivo, archivo_hash, cuenta_detectada, moneda,
        fecha_desde, fecha_hasta, filas_totales, filas_nuevas, filas_omitidas, filas_sin_mapeo, filas_ignoradas,
        movimientos_creados, monto_neto, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada')`,
      [
        preview.sucursalId,
        preview.bancoId,
        userId,
        adapterClave,
        nombreArchivo,
        preview.archivoHash,
        preview.cuentaDetectada,
        preview.moneda,
        preview.fechaDesde,
        preview.fechaHasta,
        preview.filasTotales,
        preview.filasNuevas,
        preview.filasOmitidas,
        preview.conceptosSinRegla.reduce((a, c) => a + c.cantidadFilas, 0),
        preview.filasIgnoradas,
        preview.movimientos.length,
        preview.desglose.netoImportado,
      ],
    )
    const importacionId = cabecera.insertId

    // ── Movimientos + filas de respaldo ───────────────────────────────────────
    let movimientosCreados = 0

    /**
     * Filas de respaldo acumuladas para insertarlas en lotes.
     *
     * POR QUÉ EN LOTES: un extracto mensual trae ~4.600 líneas. Insertarlas de a
     * una son 4.600 viajes de ida y vuelta contra la base — con latencias de
     * 30-250 ms eso es varios MINUTOS con la transacción abierta, reteniendo una
     * conexión del pool y bloqueando al resto de la aplicación. Si además el
     * usuario reintenta porque parece colgado, las dos transacciones compiten por
     * el índice único y termina en deadlock. Agrupadas de a `LOTE_FILAS` son ~24
     * statements en total.
     */
    const filasPendientes: unknown[][] = []

    for (const mov of preview.movimientos) {
      const { resuelto } = resolverDestino(
        {
          concepto: mov.concepto,
          descripcion: mov.descripcion,
          categoria: mov.categoria,
          subcategoria: mov.subcategoria,
          medioPago: mov.medioPago,
          proveedor: mov.proveedor,
          agrupacion: 'diaria',
          tipoEsperado: mov.tipo,
        },
        catalogos,
      )

      // No debería pasar: `validarReglas` ya corrió. Si pasa, abortamos todo.
      if (!resuelto) {
        throw new Error(
          `No se pudo resolver el destino del movimiento "${mov.concepto}" del ${mov.fecha}. Se canceló la importación.`,
        )
      }

      // Los movimientos sí van de a uno: necesitamos el insertId de cada uno para
      // vincularle sus filas. Son pocos (decenas), así que no es el cuello de botella.
      // No se hace INSERT múltiple a propósito: con innodb_autoinc_lock_mode = 2
      // los IDs generados no están garantizados como consecutivos, y acá vincular
      // mal una fila con su movimiento sería un error de plata silencioso.
      const [insercion]: any = await connection.query(
        `INSERT INTO movimientos
         (sucursal_id, user_id, fecha, concepto, comentarios, monto, tipo_movimiento, origen, importacion_id,
          saldo, prioridad, estado, categoria_id, subcategoria_id, descripcion_id, proveedor_id,
          banco_id, medio_pago_id, tipo, moneda)
         VALUES (?, ?, ?, ?, ?, ?, 'banco', 'importacion', ?, 'saldo_real', 'media', 'completado',
                 ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          preview.sucursalId,
          userId,
          normalizarFecha(mov.fecha),
          mov.concepto,
          `Importado del extracto · ${mov.cantidadFilas} movimiento(s) del banco · conceptos ${mov.codigosBanco.join(', ')}`,
          mov.monto,
          importacionId,
          resuelto.categoria_id,
          resuelto.subcategoria_id,
          resuelto.descripcion_id,
          resuelto.proveedor_id,
          preview.bancoId,
          resuelto.medio_pago_id,
          mov.tipo,
          preview.moneda,
        ],
      )
      movimientosCreados++

      for (const hash of mov.filaHashes) {
        const fila = filasPorHash.get(hash) ?? null
        filasPendientes.push([
          importacionId,
          insercion.insertId,
          preview.sucursalId,
          preview.bancoId,
          hash,
          fila?.operacionId ?? null,
          fila?.fecha ?? mov.fecha,
          fila?.conceptoCodigo ?? null,
          fila?.conceptoDescripcion ?? null,
          fila?.grupoCodigo ?? null,
          fila?.descripcionBanco ?? null,
          fila?.monto ?? 0,
          fila?.estadoBanco ?? null,
          fila?.saldoBanco ?? null,
          fila ? JSON.stringify(fila.raw) : null,
        ])
      }
    }

    // Respaldo fila por fila, en lotes. El UNIQUE (sucursal, banco, fila_hash) es
    // la barrera final contra duplicados: si dos usuarios confirman el mismo
    // archivo a la vez, el segundo falla acá y la transacción se revierte entera.
    await insertarFilasEnLotes(connection, filasPendientes)

    await connection.commit()

    res.status(201).json({
      success: true,
      message:
        `Se importaron ${movimientosCreados} movimiento(s) a partir de ${preview.filasNuevas} línea(s) del extracto.` +
        (preview.filasOmitidas > 0 ? ` Se omitieron ${preview.filasOmitidas} línea(s) ya cargadas.` : ''),
      data: {
        importacion_id: importacionId,
        movimientos_creados: movimientosCreados,
        filas_nuevas: preview.filasNuevas,
        filas_omitidas: preview.filasOmitidas,
        filas_ignoradas: preview.filasIgnoradas,
        monto_neto: preview.desglose.netoImportado,
        desglose: preview.desglose,
      },
    })
  } catch (error: any) {
    await connection.rollback().catch(() => {})

    // Ambos códigos significan lo mismo para el usuario: hubo dos importaciones
    // pisándose. La transacción se revirtió entera, así que no quedó nada a medias.
    if (error?.code === 'ER_DUP_ENTRY' || error?.code === 'ER_LOCK_DEADLOCK') {
      return res.status(409).json({
        success: false,
        message:
          'Se estaba importando este mismo extracto al mismo tiempo desde otra pestaña o usuario. ' +
          'No se creó nada. Volvé a subir el archivo para ver el estado actual.',
      })
    }

    if (error?.code === 'ETIMEDOUT' || error?.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
      return res.status(504).json({
        success: false,
        message:
          'La base de datos tardó demasiado y se canceló la importación. No se guardó nada. ' +
          'Volvé a intentar; si el extracto es muy grande, probá importarlo por períodos más cortos.',
      })
    }

    console.error('Error al confirmar importación bancaria:', error)
    res.status(500).json({ success: false, message: 'Error al importar los movimientos. No se guardó nada.' })
  } finally {
    connection.release()
  }
}

// ─────────────────────────────────────────────────────────────
//  GET /api/importacion-bancaria/:sucursalId/historial
// ─────────────────────────────────────────────────────────────
export const getHistorial = async (req: Request, res: Response) => {
  try {
    const { sucursalId } = req.params

    if (!(await verificarAccesoSucursal(req.user!, sucursalId))) {
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal.' })
    }

    const limite = Math.min(Number(req.query.limit) || 30, 100)

    const filas: any = await query(
      `SELECT i.*, b.nombre AS banco_nombre, u.nombre AS usuario_nombre
       FROM importaciones_bancarias i
       LEFT JOIN bancos b ON i.banco_id = b.id
       LEFT JOIN usuarios u ON i.user_id = u.id
       WHERE i.sucursal_id = ?
       ORDER BY i.created_at DESC
       LIMIT ?`,
      [sucursalId, limite],
    )

    res.json({ success: true, data: filas })
  } catch (error) {
    console.error('Error al obtener historial de importaciones:', error)
    res.status(500).json({ success: false, message: 'Error al obtener el historial.' })
  }
}

// ─────────────────────────────────────────────────────────────
//  POST /api/importacion-bancaria/:id/revertir
// ─────────────────────────────────────────────────────────────
/**
 * Deshace una importación completa: borra (soft delete) los movimientos que creó
 * y libera sus filas, de modo que el mismo extracto pueda volver a importarse.
 * Es la red de seguridad para cuando alguien sube el archivo equivocado.
 */
export const revertirImportacion = async (req: Request, res: Response) => {
  const connection = await getConnection()

  try {
    const { id } = req.params

    const [imp]: any = await connection.query('SELECT * FROM importaciones_bancarias WHERE id = ?', [id])
    if (!imp.length) {
      connection.release()
      return res.status(404).json({ success: false, message: 'No existe esa importación.' })
    }
    const importacion = imp[0]

    if (!(await verificarAccesoSucursal(req.user!, importacion.sucursal_id))) {
      connection.release()
      return res.status(403).json({ success: false, message: 'No tenés acceso a esta sucursal.' })
    }
    if (importacion.estado === 'revertida') {
      connection.release()
      return res.status(409).json({ success: false, message: 'Esa importación ya fue revertida.' })
    }

    await connection.beginTransaction()

    // Si algún movimiento importado se editó a mano después, avisamos pero igual
    // lo revertimos: el usuario pidió deshacer explícitamente.
    const [editados]: any = await connection.query(
      `SELECT COUNT(*) AS n FROM movimientos
       WHERE importacion_id = ? AND deleted_at IS NULL AND updated_at > created_at`,
      [id],
    )

    const [borrados]: any = await connection.query(
      `UPDATE movimientos SET deleted_at = NOW() WHERE importacion_id = ? AND deleted_at IS NULL`,
      [id],
    )

    // Borrar las filas libera el UNIQUE y permite reimportar el mismo extracto.
    await connection.query('DELETE FROM importaciones_bancarias_filas WHERE importacion_id = ?', [id])

    await connection.query(
      `UPDATE importaciones_bancarias SET estado = 'revertida', revertida_por = ?, revertida_at = NOW() WHERE id = ?`,
      [req.user!.id, id],
    )

    await connection.commit()

    res.json({
      success: true,
      message: `Se revirtió la importación: ${borrados.affectedRows} movimiento(s) eliminado(s).`,
      data: {
        movimientos_eliminados: borrados.affectedRows,
        movimientos_que_habian_sido_editados: editados[0]?.n ?? 0,
      },
    })
  } catch (error) {
    await connection.rollback().catch(() => {})
    console.error('Error al revertir importación:', error)
    res.status(500).json({ success: false, message: 'Error al revertir la importación. No se cambió nada.' })
  } finally {
    connection.release()
  }
}
