import { Request, Response } from 'express'
import path from 'path'
import { put } from '@vercel/blob'
import { getConnection, query } from '../config/database'
import {
  computeAdjuntosFaltantesByPersonal,
  computeVencimientosProximosByPersonal,
  listArchivosByPersonal,
} from '../services/personalArchivosService'
import { normalizeUbicacionPostal } from '../services/codigosPostalesService'

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function isValidEmail(value: string | null): boolean {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function parseBoolean(value: unknown, defaultValue = false): boolean {
  if (value === undefined || value === null || value === '') return defaultValue
  return value === true || value === 1 || value === '1' || value === 'true'
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

async function persistCarnetFile(personalId: number, file: Express.Multer.File): Promise<string> {
  const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
  if (!isProduction) {
    const diskFile = file as Express.Multer.File & { filename?: string }
    if (!diskFile.filename) throw new Error('No se pudo guardar el archivo del carnet')
    return `uploads/personal/${diskFile.filename}`
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN no configurado')
  const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
  const blob = await put(`personal/carnet-${personalId}-${suffix}${path.extname(file.originalname)}`, file.buffer, {
    access: 'private',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })
  return blob.url
}

const PERSONAL_PUBLIC_FIELDS = `p.id, p.legajo, p.nombre, p.dni, p.cuil, p.puesto_id, pu.nombre AS puesto_nombre,
              p.email, p.telefono, p.fecha_nacimiento, p.domicilio_real, p.domicilio_dni,
              p.domicilio_real_provincia_codigo, p.domicilio_real_localidad, p.domicilio_real_codigo_postal,
              p.domicilio_dni_provincia_codigo, p.domicilio_dni_localidad, p.domicilio_dni_codigo_postal,
              p.sucursal_id, p.fecha_incorporacion, p.fecha_inicio_cobro,
              p.periodo_prueba, p.periodo_prueba_dias, p.jornada_semanal_dias, p.jornada_diaria_horas,
              p.propuesta_economica, p.beneficios, p.condicion_laboral, p.fecha_alta_temprana,
              p.banco, p.cbu, p.carnet_manipulacion_alimentos, p.carnet_archivo_url, p.carnet_archivo_nombre, p.carnet_vencimiento,
              p.solicitud_alta_id, p.activo, p.created_at, p.updated_at`

const PERSONAL_CURRENT_CARNET_FIELDS = `(SELECT d.url FROM personal_documentos d
                 WHERE d.personal_id = p.id AND d.tipo_doc = 'carnet_manipulacion_alimentos'
                   AND d.deleted_at IS NULL ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS carnet_documento_url,
                (SELECT d.nombre_original FROM personal_documentos d
                 WHERE d.personal_id = p.id AND d.tipo_doc = 'carnet_manipulacion_alimentos'
                   AND d.deleted_at IS NULL ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS carnet_documento_nombre,
                (SELECT d.fecha_vencimiento FROM personal_documentos d
                 WHERE d.personal_id = p.id AND d.tipo_doc = 'carnet_manipulacion_alimentos'
                   AND d.deleted_at IS NULL ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS carnet_documento_vencimiento`

function withCurrentCarnet(personal: Record<string, unknown>): Record<string, unknown> {
  const {
    carnet_documento_url: documentoUrl,
    carnet_documento_nombre: documentoNombre,
    carnet_documento_vencimiento: documentoVencimiento,
    ...personalPublico
  } = personal
  return {
    ...personalPublico,
    carnet_archivo_url: documentoUrl ?? personal.carnet_archivo_url,
    carnet_archivo_nombre: documentoNombre ?? personal.carnet_archivo_nombre,
    carnet_vencimiento: documentoVencimiento ?? personal.carnet_vencimiento,
  }
}

// GET /api/personal  —  ?sucursal_id=N filtra por sucursal
export const getPersonal = async (req: Request, res: Response) => {
  try {
    const sucursalId = req.query.sucursal_id ? Number(req.query.sucursal_id) : null

    const result = sucursalId
      ? await query(
          `SELECT ${PERSONAL_PUBLIC_FIELDS}
           FROM personal p
           LEFT JOIN puestos pu ON pu.id = p.puesto_id
           WHERE p.deleted_at IS NULL AND p.sucursal_id = ?
           ORDER BY p.legajo ASC`,
          [sucursalId],
        )
      : await query(
          `SELECT ${PERSONAL_PUBLIC_FIELDS}
           FROM personal p
           LEFT JOIN puestos pu ON pu.id = p.puesto_id
           WHERE p.deleted_at IS NULL
           ORDER BY p.legajo ASC`,
        )

    const rows = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
    const personalFlags = rows.map(r => ({
      id: Number(r.id),
      solicitud_alta_id: r.solicitud_alta_id != null ? Number(r.solicitud_alta_id) : null,
      carnet_manipulacion_alimentos: Number(r.carnet_manipulacion_alimentos ?? 0),
    }))
    const [faltantesMap, vencimientosMap] = await Promise.all([
      computeAdjuntosFaltantesByPersonal(personalFlags),
      computeVencimientosProximosByPersonal(personalFlags),
    ])

    const enriched = rows.map(r => {
      const faltantes = faltantesMap.get(Number(r.id)) ?? []
      return { ...r, adjuntos_faltantes: faltantes, vencimientos_proximos: vencimientosMap.get(Number(r.id)) ?? [] }
    })

    res.json({ success: true, data: enriched })
  } catch (error) {
    console.error('Error al obtener personal:', error)
    res.status(500).json({ success: false, message: 'Error al obtener personal' })
  }
}

// GET /api/personal/:id
export const getPersonalById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result: any = await query(
      `SELECT ${PERSONAL_PUBLIC_FIELDS}, p.datos_alta_json, ${PERSONAL_CURRENT_CARNET_FIELDS}
       FROM personal p
       LEFT JOIN puestos pu ON pu.id = p.puesto_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    )
    if (!Array.isArray(result) || result.length === 0) {
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }
    const persona = withCurrentCarnet(result[0] as Record<string, unknown>)
    const personalFlags = [
      {
        id: Number(persona.id),
        solicitud_alta_id: persona.solicitud_alta_id != null ? Number(persona.solicitud_alta_id) : null,
        carnet_manipulacion_alimentos: Number(persona.carnet_manipulacion_alimentos ?? 0),
      },
    ]
    const [faltantesMap, vencimientosMap] = await Promise.all([
      computeAdjuntosFaltantesByPersonal(personalFlags),
      computeVencimientosProximosByPersonal(personalFlags),
    ])
    res.json({
      success: true,
      data: {
        ...persona,
        adjuntos_faltantes: faltantesMap.get(Number(persona.id)) ?? [],
        vencimientos_proximos: vencimientosMap.get(Number(persona.id)) ?? [],
      },
    })
  } catch (error) {
    console.error('Error al obtener colaborador:', error)
    res.status(500).json({ success: false, message: 'Error al obtener colaborador' })
  }
}

// GET /api/personal/:id/archivos
export const getPersonalArchivos = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'ID inválido' })
    }
    const archivos = await listArchivosByPersonal(id)
    res.json({ success: true, data: archivos })
  } catch (error) {
    console.error('Error al listar archivos del colaborador:', error)
    res.status(500).json({ success: false, message: 'Error al listar archivos del colaborador' })
  }
}

// GET /api/personal/alertas-documentacion
export const getAlertasDocumentacion = async (_req: Request, res: Response) => {
  try {
    const rows = (await query(
      `SELECT p.id, p.sucursal_id, s.nombre AS sucursal_nombre, p.solicitud_alta_id, p.carnet_manipulacion_alimentos
       FROM personal p INNER JOIN sucursales s ON s.id = p.sucursal_id
       WHERE p.deleted_at IS NULL AND p.activo = 1 ORDER BY s.nombre ASC`,
    )) as Array<Record<string, unknown>>
    const flags = rows.map(row => ({
      id: Number(row.id),
      solicitud_alta_id: row.solicitud_alta_id != null ? Number(row.solicitud_alta_id) : null,
      carnet_manipulacion_alimentos: Number(row.carnet_manipulacion_alimentos ?? 0),
    }))
    const [faltantesMap, vencimientosMap] = await Promise.all([
      computeAdjuntosFaltantesByPersonal(flags),
      computeVencimientosProximosByPersonal(flags),
    ])
    const agrupadas = new Map<
      number,
      { sucursal_id: number; sucursal_nombre: string; faltantes: number; vencimientos: number }
    >()
    for (const row of rows) {
      const sucursalId = Number(row.sucursal_id)
      const actual = agrupadas.get(sucursalId) ?? {
        sucursal_id: sucursalId,
        sucursal_nombre: String(row.sucursal_nombre),
        faltantes: 0,
        vencimientos: 0,
      }
      actual.faltantes += (faltantesMap.get(Number(row.id)) ?? []).length
      actual.vencimientos += (vencimientosMap.get(Number(row.id)) ?? []).length
      agrupadas.set(sucursalId, actual)
    }
    res.json({ success: true, data: [...agrupadas.values()].filter(alerta => alerta.faltantes || alerta.vencimientos) })
  } catch (error) {
    console.error('Error al obtener alertas de documentación:', error)
    res.status(500).json({ success: false, message: 'Error al obtener alertas de documentación' })
  }
}

// POST /api/personal
export const createPersonal = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null
  try {
    const {
      nombre,
      dni,
      email,
      puesto_id,
      sucursal_id,
      fecha_incorporacion,
      periodo_prueba,
      periodo_prueba_dias,
      carnet_manipulacion_alimentos,
    } = req.body
    const emailNormalizado = normalizeEmail(email)

    if (!nombre || !dni || !puesto_id || !sucursal_id || !fecha_incorporacion) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, DNI, puesto, sucursal y fecha de incorporación son requeridos',
      })
    }
    if (!isValidEmail(emailNormalizado)) {
      return res.status(400).json({ success: false, message: 'El email del colaborador no tiene un formato válido' })
    }
    connection = await getConnection()
    await connection.beginTransaction()

    // Verificar DNI duplicado (incluyendo soft-deleted para integridad)
    const [dniCheck]: any = await connection.execute(`SELECT id FROM personal WHERE dni = ?`, [dni])
    if (Array.isArray(dniCheck) && dniCheck.length > 0) {
      await connection.rollback()
      return res.status(409).json({ success: false, message: 'Ya existe un colaborador con ese DNI' })
    }

    // Generar siguiente legajo (incluye borrados para mantener unicidad)
    const [lastRow]: any = await connection.execute(`SELECT MAX(CAST(legajo AS UNSIGNED)) AS max_num FROM personal`)
    const maxNum =
      Array.isArray(lastRow) && lastRow.length > 0 && lastRow[0].max_num != null ? Number(lastRow[0].max_num) : 0
    const nuevoLegajo = String(maxNum + 1).padStart(6, '0')

    const [result]: any = await connection.execute(
      `INSERT INTO personal
       (legajo, nombre, dni, email, puesto_id, sucursal_id, fecha_incorporacion, periodo_prueba,
        periodo_prueba_dias, carnet_manipulacion_alimentos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nuevoLegajo,
        nombre.trim(),
        dni.trim(),
        emailNormalizado,
        puesto_id,
        sucursal_id,
        fecha_incorporacion,
        periodo_prueba ? 1 : 0,
        periodo_prueba ? Number(periodo_prueba_dias ?? 180) : null,
        carnet_manipulacion_alimentos ? 1 : 0,
      ],
    )

    const [newRow]: any = await connection.execute(
      `SELECT ${PERSONAL_PUBLIC_FIELDS}
       FROM personal p
       LEFT JOIN puestos pu ON pu.id = p.puesto_id
       WHERE p.id = ?`,
      [result.insertId],
    )

    await connection.commit()
    res.status(201).json({ success: true, data: newRow[0] })
  } catch (error) {
    if (connection) await connection.rollback()
    console.error('Error al crear colaborador:', error)
    res.status(500).json({ success: false, message: 'Error al crear colaborador' })
  } finally {
    if (connection) connection.release()
  }
}

// PUT /api/personal/:id
export const updatePersonal = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof getConnection>> | null = null
  try {
    const { id } = req.params
    const {
      nombre,
      dni,
      email,
      puesto_id,
      sucursal_id,
      fecha_incorporacion,
      periodo_prueba,
      periodo_prueba_dias,
      carnet_manipulacion_alimentos,
      activo,
      condicion_laboral,
      fecha_alta_temprana,
      carnet_vencimiento,
      domicilio_real,
      domicilio_real_provincia_codigo,
      domicilio_real_localidad,
      domicilio_real_codigo_postal,
      domicilio_dni,
      domicilio_dni_provincia_codigo,
      domicilio_dni_localidad,
      domicilio_dni_codigo_postal,
    } = req.body
    const emailNormalizado = normalizeEmail(email)
    const periodoPruebaValue = parseBoolean(periodo_prueba)
    const periodoPruebaDiasValue = periodoPruebaValue ? Number(periodo_prueba_dias || 180) : null
    const carnetValue = parseBoolean(carnet_manipulacion_alimentos)
    const activoValue = parseBoolean(activo, true)
    const domicilioRealPostalKeys = [
      'domicilio_real_provincia_codigo',
      'domicilio_real_localidad',
      'domicilio_real_codigo_postal',
    ]
    const domicilioDniPostalKeys = [
      'domicilio_dni_provincia_codigo',
      'domicilio_dni_localidad',
      'domicilio_dni_codigo_postal',
    ]
    const hasDomicilioRealPostalPayload = domicilioRealPostalKeys.some(key =>
      Object.prototype.hasOwnProperty.call(req.body, key),
    )
    const hasDomicilioDniPostalPayload = domicilioDniPostalKeys.some(key =>
      Object.prototype.hasOwnProperty.call(req.body, key),
    )
    let domicilioRealPostal: ReturnType<typeof normalizeUbicacionPostal> | null = null
    let domicilioDniPostal: ReturnType<typeof normalizeUbicacionPostal> | null = null
    if (hasDomicilioRealPostalPayload) {
      try {
        domicilioRealPostal = normalizeUbicacionPostal({
          provincia_codigo: domicilio_real_provincia_codigo,
          localidad: domicilio_real_localidad,
          codigo_postal: domicilio_real_codigo_postal,
        })
      } catch (error: unknown) {
        return res.status(400).json({
          success: false,
          message: error instanceof Error ? `Dirección real: ${error.message}` : 'La ubicación postal no es válida',
        })
      }
    }
    if (hasDomicilioDniPostalPayload) {
      try {
        domicilioDniPostal = normalizeUbicacionPostal({
          provincia_codigo: domicilio_dni_provincia_codigo,
          localidad: domicilio_dni_localidad,
          codigo_postal: domicilio_dni_codigo_postal,
        })
      } catch (error: unknown) {
        return res.status(400).json({
          success: false,
          message:
            error instanceof Error ? `Domicilio según DNI: ${error.message}` : 'La ubicación postal no es válida',
        })
      }
    }

    if (!nombre || !dni || !puesto_id || !sucursal_id || !fecha_incorporacion) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, DNI, puesto, sucursal y fecha de incorporación son requeridos',
      })
    }
    if (!isValidEmail(emailNormalizado)) {
      return res.status(400).json({ success: false, message: 'El email del colaborador no tiene un formato válido' })
    }
    if (periodoPruebaValue && (!Number.isFinite(periodoPruebaDiasValue) || Number(periodoPruebaDiasValue) <= 0)) {
      return res.status(400).json({ success: false, message: 'La duración del período de prueba no es válida' })
    }

    let condicionLaboralValue: number | null = null
    if (condicion_laboral !== undefined && condicion_laboral !== null && condicion_laboral !== '') {
      const num = Number(condicion_laboral)
      if (num !== 1 && num !== 2) {
        return res.status(400).json({ success: false, message: 'La condición laboral debe ser 1 o 2' })
      }
      condicionLaboralValue = num
    }

    let fechaAltaTempranaValue: string | null = null
    if (condicionLaboralValue === 1 && fecha_alta_temprana) {
      const fa = String(fecha_alta_temprana).trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fa)) {
        return res.status(400).json({ success: false, message: 'La fecha de alta temprana no es válida' })
      }
      fechaAltaTempranaValue = fa
    }

    if (req.file && !carnetValue) {
      return res.status(400).json({ success: false, message: 'Active el carnet antes de adjuntar el archivo' })
    }

    connection = await getConnection()
    await connection.beginTransaction()

    const [existing]: any = await connection.execute(
      `SELECT p.id, p.domicilio_real, p.domicilio_dni,
              p.domicilio_real_provincia_codigo, p.domicilio_real_localidad, p.domicilio_real_codigo_postal,
              p.domicilio_dni_provincia_codigo, p.domicilio_dni_localidad, p.domicilio_dni_codigo_postal,
              p.carnet_archivo_url, p.carnet_archivo_nombre, p.carnet_vencimiento,
              (SELECT d.url FROM personal_documentos d
               WHERE d.personal_id = p.id AND d.tipo_doc = 'carnet_manipulacion_alimentos'
                 AND d.deleted_at IS NULL ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS documento_carnet_url,
              (SELECT d.fecha_vencimiento FROM personal_documentos d
               WHERE d.personal_id = p.id AND d.tipo_doc = 'carnet_manipulacion_alimentos'
                 AND d.deleted_at IS NULL ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS documento_carnet_vencimiento,
              (SELECT a.url FROM rrhh_solicitudes_archivos a
               WHERE a.solicitud_id = p.solicitud_alta_id AND a.tipo_doc = 'carnet_manipulacion_alimentos'
               LIMIT 1) AS alta_carnet_url
       FROM personal p WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    )
    if (!Array.isArray(existing) || existing.length === 0) {
      await connection.rollback()
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }

    const existingPersonal = existing[0] as Record<string, unknown>
    const effectiveDomicilioReal = Object.prototype.hasOwnProperty.call(req.body, 'domicilio_real')
      ? normalizeOptionalText(domicilio_real)
      : (existingPersonal.domicilio_real ?? null)
    const effectiveDomicilioDni = Object.prototype.hasOwnProperty.call(req.body, 'domicilio_dni')
      ? normalizeOptionalText(domicilio_dni)
      : (existingPersonal.domicilio_dni ?? null)
    const effectiveDomicilioRealPostal = domicilioRealPostal ?? {
      provinciaCodigo: existingPersonal.domicilio_real_provincia_codigo ?? null,
      localidad: existingPersonal.domicilio_real_localidad ?? null,
      codigoPostal: existingPersonal.domicilio_real_codigo_postal ?? null,
    }
    const effectiveDomicilioDniPostal = domicilioDniPostal ?? {
      provinciaCodigo: existingPersonal.domicilio_dni_provincia_codigo ?? null,
      localidad: existingPersonal.domicilio_dni_localidad ?? null,
      codigoPostal: existingPersonal.domicilio_dni_codigo_postal ?? null,
    }
    const requestedCarnetDate = typeof carnet_vencimiento === 'string' ? carnet_vencimiento.trim() : ''
    if (requestedCarnetDate && !isValidDate(requestedCarnetDate)) {
      await connection.rollback()
      return res.status(400).json({ success: false, message: 'La fecha de vencimiento del carnet no es válida' })
    }
    const effectiveCarnetDate =
      requestedCarnetDate ||
      normalizeDate(existingPersonal.documento_carnet_vencimiento) ||
      normalizeDate(existingPersonal.carnet_vencimiento)
    const hasExistingCarnetFile = Boolean(
      existingPersonal.documento_carnet_url || existingPersonal.carnet_archivo_url || existingPersonal.alta_carnet_url,
    )
    if (carnetValue && !req.file && !hasExistingCarnetFile) {
      await connection.rollback()
      return res.status(400).json({ success: false, message: 'Adjunte el archivo del carnet de manipulación' })
    }
    if (carnetValue && !effectiveCarnetDate) {
      await connection.rollback()
      return res.status(400).json({ success: false, message: 'Indique la fecha de vencimiento del carnet' })
    }

    // Verificar DNI duplicado en otro registro
    const [dniCheck]: any = await connection.execute(`SELECT id FROM personal WHERE dni = ? AND id != ?`, [dni, id])
    if (Array.isArray(dniCheck) && dniCheck.length > 0) {
      await connection.rollback()
      return res.status(409).json({ success: false, message: 'Ya existe un colaborador con ese DNI' })
    }

    let carnetFileUrl: string | null = null
    if (req.file) {
      carnetFileUrl = await persistCarnetFile(Number(id), req.file)
      await connection.execute(
        `INSERT INTO personal_documentos
         (personal_id, label, tipo_doc, url, nombre_original, fecha_vencimiento, subido_por_id, subido_por_nombre)
         VALUES (?, 'Carnet de manipulación', 'carnet_manipulacion_alimentos', ?, ?, ?, ?, ?)`,
        [id, carnetFileUrl, req.file.originalname, effectiveCarnetDate, req.user?.id ?? null, req.user?.nombre ?? null],
      )
    } else if (carnetValue && requestedCarnetDate && existingPersonal.documento_carnet_url) {
      await connection.execute(
        `UPDATE personal_documentos SET fecha_vencimiento = ?
         WHERE personal_id = ? AND tipo_doc = 'carnet_manipulacion_alimentos' AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [effectiveCarnetDate, id],
      )
    }

    await connection.execute(
      `UPDATE personal
       SET nombre = ?, dni = ?, puesto_id = ?, sucursal_id = ?, fecha_incorporacion = ?,
           email = ?, domicilio_real = ?, domicilio_dni = ?,
           domicilio_real_provincia_codigo = ?, domicilio_real_localidad = ?, domicilio_real_codigo_postal = ?,
           domicilio_dni_provincia_codigo = ?, domicilio_dni_localidad = ?, domicilio_dni_codigo_postal = ?,
           periodo_prueba = ?, periodo_prueba_dias = ?, carnet_manipulacion_alimentos = ?, activo = ?,
           condicion_laboral = ?, fecha_alta_temprana = ?,
           carnet_archivo_url = CASE WHEN ? IS NOT NULL THEN ? ELSE carnet_archivo_url END,
           carnet_archivo_nombre = CASE WHEN ? IS NOT NULL THEN ? ELSE carnet_archivo_nombre END,
           carnet_vencimiento = CASE WHEN ? = 1 THEN ? ELSE carnet_vencimiento END
       WHERE id = ?`,
      [
        nombre.trim(),
        dni.trim(),
        puesto_id,
        sucursal_id,
        fecha_incorporacion,
        emailNormalizado,
        effectiveDomicilioReal,
        effectiveDomicilioDni,
        effectiveDomicilioRealPostal.provinciaCodigo,
        effectiveDomicilioRealPostal.localidad,
        effectiveDomicilioRealPostal.codigoPostal,
        effectiveDomicilioDniPostal.provinciaCodigo,
        effectiveDomicilioDniPostal.localidad,
        effectiveDomicilioDniPostal.codigoPostal,
        periodoPruebaValue ? 1 : 0,
        periodoPruebaDiasValue,
        carnetValue ? 1 : 0,
        activoValue ? 1 : 0,
        condicionLaboralValue,
        fechaAltaTempranaValue,
        carnetFileUrl,
        carnetFileUrl,
        carnetFileUrl,
        req.file?.originalname ?? null,
        carnetValue ? 1 : 0,
        effectiveCarnetDate,
        id,
      ],
    )

    const [updated]: any = await connection.execute(
      `SELECT ${PERSONAL_PUBLIC_FIELDS}, ${PERSONAL_CURRENT_CARNET_FIELDS}
       FROM personal p
       LEFT JOIN puestos pu ON pu.id = p.puesto_id
       WHERE p.id = ?`,
      [id],
    )

    await connection.commit()
    res.json({ success: true, data: withCurrentCarnet(updated[0] as Record<string, unknown>) })
  } catch (error) {
    if (connection) await connection.rollback()
    console.error('Error al actualizar colaborador:', error)
    res.status(500).json({ success: false, message: 'Error al actualizar colaborador' })
  } finally {
    if (connection) connection.release()
  }
}

// DELETE /api/personal/:id
export const deletePersonal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result: any = await query(`UPDATE personal SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`, [id])
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Colaborador no encontrado' })
    }
    res.json({ success: true, message: 'Colaborador eliminado correctamente' })
  } catch (error) {
    console.error('Error al eliminar colaborador:', error)
    res.status(500).json({ success: false, message: 'Error al eliminar colaborador' })
  }
}
