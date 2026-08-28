import { query } from '../config/database'

/** Documentos requeridos para una Alta. El carnet sólo cuenta si el colaborador lo posee. */
export const ALTA_TIPOS_REQUERIDOS = [
  'dni_frente_dorso',
  'ddjj_domicilio',
  'descripcion_puesto_firmada',
  'foto_colaborador',
  'normas_convivencia',
  'constancia_uniforme',
] as const

export type AltaTipoRequerido = (typeof ALTA_TIPOS_REQUERIDOS)[number] | 'carnet_manipulacion_alimentos'

const LABELS: Record<string, string> = {
  // Altas
  dni_frente_dorso: 'DNI (ambos lados)',
  ddjj_domicilio: 'DDJJ de domicilio',
  descripcion_puesto_firmada: 'Descripción de puesto firmada',
  foto_colaborador: 'Foto del colaborador',
  normas_convivencia: 'Normas de convivencia',
  constancia_uniforme: 'Constancia de uniforme',
  carnet_manipulacion_alimentos: 'Carnet de manipulación',
  // Bajas
  carta_documento: 'Carta documento / telegrama',
  // Apercibimientos / Suspensiones / Incentivos (solicitudes individuales)
  apercibimiento_adjunto: 'Apercibimiento',
  suspension_adjunto: 'Suspensión',
  incentivo_adjunto: 'Incentivo / Premio',
}

export function labelForTipoDoc(tipoDoc: string): string {
  return LABELS[tipoDoc] ?? tipoDoc
}

export function isTipoDocumentoLegajo(value: string): value is AltaTipoRequerido {
  return [...ALTA_TIPOS_REQUERIDOS, 'carnet_manipulacion_alimentos'].includes(value as AltaTipoRequerido)
}

interface ArchivosFaltantesRow {
  personal_id: number
  tipo_doc: string
}

interface PersonalFlagRow {
  id: number
  solicitud_alta_id: number | null
  carnet_manipulacion_alimentos: number
}

export interface VencimientoLegajo {
  tipo: 'carnet_manipulacion' | 'documento_legajo'
  label: string
  fecha_vencimiento: string
  dias_restantes: number
}

const DEFAULT_DIAS_ALERTA_VENCIMIENTOS = 30

function getDiasAlertaVencimientos(): number {
  const value = Number(process.env.RRHH_ALERTA_LEGAJOS_DIAS_ANTES)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DIAS_ALERTA_VENCIMIENTOS
}

/** Vencimientos ya ocurridos o próximos, para señalizarlos en la vista de legajos. */
export async function computeVencimientosProximosByPersonal(
  personal: PersonalFlagRow[],
): Promise<Map<number, VencimientoLegajo[]>> {
  const out = new Map<number, VencimientoLegajo[]>()
  if (personal.length === 0) return out

  const ids = personal.map(p => p.id)
  const placeholders = ids.map(() => '?').join(',')
  const diasAntes = getDiasAlertaVencimientos()
  const rows = (await query(
    `SELECT p.id AS personal_id, 'carnet_manipulacion' AS tipo, 'Carnet de manipulación' AS label,
            DATE_FORMAT(p.carnet_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
            DATEDIFF(p.carnet_vencimiento, CURDATE()) AS dias_restantes
     FROM personal p
     WHERE p.id IN (${placeholders}) AND p.carnet_vencimiento IS NOT NULL
       AND p.carnet_vencimiento <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
     UNION ALL
     SELECT d.personal_id, 'documento_legajo' AS tipo, d.label,
            DATE_FORMAT(d.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
            DATEDIFF(d.fecha_vencimiento, CURDATE()) AS dias_restantes
     FROM personal_documentos d
     WHERE d.personal_id IN (${placeholders}) AND d.deleted_at IS NULL AND d.fecha_vencimiento IS NOT NULL
       AND d.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
     ORDER BY fecha_vencimiento ASC`,
    [...ids, diasAntes, ...ids, diasAntes],
  )) as Array<VencimientoLegajo & { personal_id: number }>

  for (const row of rows) {
    const item: VencimientoLegajo = {
      tipo: row.tipo,
      label: row.label,
      fecha_vencimiento: row.fecha_vencimiento,
      dias_restantes: Number(row.dias_restantes),
    }
    const items = out.get(Number(row.personal_id)) ?? []
    items.push(item)
    out.set(Number(row.personal_id), items)
  }
  return out
}

/**
 * Para una lista de personal, devuelve un mapa con los tipos_doc faltantes
 * en su solicitud de alta (si tienen una). Si no hay solicitud de alta, devuelve [].
 */
export async function computeAdjuntosFaltantesByPersonal(personal: PersonalFlagRow[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>()
  if (personal.length === 0) return out

  const solicitudIds = personal.map(p => p.solicitud_alta_id).filter((v): v is number => v != null && v > 0)

  let archivosBySolicitud = new Map<number, Set<string>>()
  if (solicitudIds.length > 0) {
    const placeholders = solicitudIds.map(() => '?').join(',')
    const rows = (await query(
      `SELECT solicitud_id, tipo_doc
       FROM rrhh_solicitudes_archivos
       WHERE solicitud_id IN (${placeholders})`,
      solicitudIds,
    )) as Array<{ solicitud_id: number; tipo_doc: string }>

    archivosBySolicitud = rows.reduce((acc, r) => {
      const sid = Number(r.solicitud_id)
      const set = acc.get(sid) ?? new Set<string>()
      set.add(String(r.tipo_doc))
      acc.set(sid, set)
      return acc
    }, new Map<number, Set<string>>())
  }

  const ids = personal.map(p => p.id)
  const directosByPersonal = new Map<number, Set<string>>()
  const directos = (await query(
    `SELECT personal_id, tipo_doc FROM personal_documentos
     WHERE personal_id IN (${ids.map(() => '?').join(',')})
       AND deleted_at IS NULL AND tipo_doc IS NOT NULL`,
    ids,
  )) as Array<{ personal_id: number; tipo_doc: string }>
  for (const documento of directos) {
    const set = directosByPersonal.get(Number(documento.personal_id)) ?? new Set<string>()
    set.add(documento.tipo_doc)
    directosByPersonal.set(Number(documento.personal_id), set)
  }

  for (const p of personal) {
    const requeridos: AltaTipoRequerido[] = [...ALTA_TIPOS_REQUERIDOS]
    if (Number(p.carnet_manipulacion_alimentos) === 1) {
      requeridos.push('carnet_manipulacion_alimentos')
    }
    const presentes = new Set([
      ...(p.solicitud_alta_id ? (archivosBySolicitud.get(Number(p.solicitud_alta_id)) ?? []) : []),
      ...(directosByPersonal.get(Number(p.id)) ?? []),
    ])
    const faltantes = requeridos.filter(t => !presentes.has(t))
    out.set(Number(p.id), faltantes)
  }

  return out
}

export interface ArchivoItem {
  tipo_doc: string
  label: string
  url: string
  nombre_original: string | null
  solicitud_id: number
  solicitud_tipo: string
  fecha_solicitud: string
  estado: string
  documento_id?: number
  fecha_vencimiento?: string | null
  subido_por_nombre?: string | null
}

function toIsoDate(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date) {
    return value.toISOString()
  }
  const asDate = new Date(String(value))
  if (!isNaN(asDate.getTime())) return asDate.toISOString()
  return String(value)
}

/**
 * Devuelve todos los archivos PDF / imágenes asociados a un personal:
 *  - Archivos de su solicitud de alta
 *  - Archivos de solicitudes individuales donde aparece como colaborador
 *  - Archivos guardados a nivel de empleado en novedades de sueldo (apercibimientos / suspensiones)
 */
export async function listArchivosByPersonal(personalId: number): Promise<ArchivoItem[]> {
  const personalRows = (await query(`SELECT solicitud_alta_id FROM personal WHERE id = ? AND deleted_at IS NULL`, [
    personalId,
  ])) as Array<{ solicitud_alta_id: number | null }>
  if (personalRows.length === 0) return []
  const altaId = personalRows[0].solicitud_alta_id

  const items: ArchivoItem[] = []

  // 1) Archivos de solicitudes propias (personal_id = ?) + solicitud de alta (que crea el personal)
  const archivosSolicitudes = (await query(
    `SELECT a.tipo_doc, a.url, a.nombre_original, u.nombre AS subido_por_nombre,
            s.id AS solicitud_id, s.tipo AS solicitud_tipo, s.fecha_solicitud, s.estado
     FROM rrhh_solicitudes_archivos a
     INNER JOIN rrhh_solicitudes s ON s.id = a.solicitud_id
     LEFT JOIN usuarios u ON u.id = s.usuario_id
     WHERE (s.personal_id = ? OR s.id = ?)
       AND s.deleted_at IS NULL
     ORDER BY s.fecha_solicitud DESC, a.id ASC`,
    [personalId, altaId ?? 0],
  )) as Array<{
    tipo_doc: string
    url: string
    nombre_original: string | null
    subido_por_nombre: string | null
    solicitud_id: number
    solicitud_tipo: string
    fecha_solicitud: string
    estado: string
  }>

  for (const r of archivosSolicitudes) {
    items.push({
      tipo_doc: String(r.tipo_doc),
      label: labelForTipoDoc(String(r.tipo_doc)),
      url: String(r.url),
      nombre_original: r.nombre_original,
      solicitud_id: Number(r.solicitud_id),
      solicitud_tipo: String(r.solicitud_tipo),
      fecha_solicitud: toIsoDate(r.fecha_solicitud),
      estado: String(r.estado),
      subido_por_nombre: r.subido_por_nombre,
    })
  }

  // 2) Archivos a nivel de empleado en novedades de sueldo (apercibimientos / suspensiones)
  const archivosEmpleados = (await query(
    `SELECT e.apercibimiento, e.apercibimiento_archivo_url, e.apercibimiento_archivo_nombre,
            e.suspension, e.suspension_archivo_url, e.suspension_archivo_nombre,
            s.id AS solicitud_id, s.tipo AS solicitud_tipo, s.fecha_solicitud, s.estado,
            u.nombre AS subido_por_nombre
     FROM rrhh_solicitudes_novedades_empleados e
     INNER JOIN rrhh_solicitudes s ON s.id = e.solicitud_id
     LEFT JOIN usuarios u ON u.id = s.usuario_id
     WHERE e.personal_id = ?
       AND s.deleted_at IS NULL
     ORDER BY s.fecha_solicitud DESC, e.id ASC`,
    [personalId],
  )) as Array<{
    apercibimiento: number
    apercibimiento_archivo_url: string | null
    apercibimiento_archivo_nombre: string | null
    suspension: number
    suspension_archivo_url: string | null
    suspension_archivo_nombre: string | null
    solicitud_id: number
    solicitud_tipo: string
    fecha_solicitud: string
    estado: string
    subido_por_nombre: string | null
  }>

  for (const r of archivosEmpleados) {
    if (Number(r.apercibimiento) === 1 && r.apercibimiento_archivo_url) {
      items.push({
        tipo_doc: 'apercibimiento_adjunto',
        label: 'Apercibimiento (novedad de sueldo)',
        url: String(r.apercibimiento_archivo_url),
        nombre_original: r.apercibimiento_archivo_nombre,
        solicitud_id: Number(r.solicitud_id),
        solicitud_tipo: String(r.solicitud_tipo),
        fecha_solicitud: toIsoDate(r.fecha_solicitud),
        estado: String(r.estado),
        subido_por_nombre: r.subido_por_nombre,
      })
    }
    if (Number(r.suspension) === 1 && r.suspension_archivo_url) {
      items.push({
        tipo_doc: 'suspension_adjunto',
        label: 'Suspensión (novedad de sueldo)',
        url: String(r.suspension_archivo_url),
        nombre_original: r.suspension_archivo_nombre,
        solicitud_id: Number(r.solicitud_id),
        solicitud_tipo: String(r.solicitud_tipo),
        fecha_solicitud: toIsoDate(r.fecha_solicitud),
        estado: String(r.estado),
        subido_por_nombre: r.subido_por_nombre,
      })
    }
  }

  // 3) Documentos subidos directamente al legajo
  const docDirectos = (await query(
    `SELECT id, label, tipo_doc, url, nombre_original, fecha_vencimiento, subido_por_nombre, created_at
     FROM personal_documentos
     WHERE personal_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [personalId],
  )) as Array<{
    id: number
    label: string
    tipo_doc: string | null
    url: string
    nombre_original: string | null
    fecha_vencimiento: Date | string | null
    subido_por_nombre: string | null
    created_at: Date | string
  }>

  for (const r of docDirectos) {
    items.push({
      tipo_doc: r.tipo_doc ?? 'documento_legajo',
      label: String(r.label),
      url: String(r.url),
      nombre_original: r.nombre_original,
      solicitud_id: 0,
      solicitud_tipo: 'Legajo',
      fecha_solicitud: toIsoDate(r.created_at),
      estado: 'Aprobada',
      documento_id: Number(r.id),
      fecha_vencimiento: r.fecha_vencimiento ? toIsoDate(r.fecha_vencimiento) : null,
      subido_por_nombre: r.subido_por_nombre,
    })
  }

  return items
}
