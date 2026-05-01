import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { query } from '../config/database'

export const TIPOS_VALIDOS = [
  'Altas',
  'Bajas',
  'Novedades de sueldo',
  'Incentivos y premios',
  'Licencias',
  'Vacaciones',
  'Suspensiones',
  'Apercibimientos',
  'Capacitaciones',
  'Pedido de uniforme',
  'Adelantos',
  'Descuentos',
  'Horas extras',
] as const

export const ESTADOS_VALIDOS = ['Pendiente', 'Aprobada', 'Rechazada', 'Cancelada'] as const

export type SolicitudTipo = (typeof TIPOS_VALIDOS)[number]
export type SolicitudEstado = (typeof ESTADOS_VALIDOS)[number]

export interface SolicitudHistorialItem {
  id: number
  solicitud_id: number
  personal_id: number | null
  usuario_id: number | null
  usuario_nombre: string | null
  evento: string
  detalle: string | null
  created_at: string
}

export interface SolicitudRow extends RowDataPacket {
  id: number
  sucursal_id: number
  sucursal_nombre: string
  personal_id: number | null
  personal_creado_id: number | null
  personal_nombre: string | null
  legajo: string | null
  dni: string | null
  usuario_id: number
  usuario_nombre: string
  resuelto_por_usuario_id: number | null
  resuelto_por_nombre: string | null
  tipo: SolicitudTipo
  estado: SolicitudEstado
  fecha_solicitud: string
  fecha_resolucion: string | null
  detalles: string | Record<string, unknown> | null
  observaciones: string | null
  motivo_resolucion: string | null
  liquidacion_final_estado: 'Pendiente' | 'Generada' | 'No aplica' | 'Error'
  created_at: string
  updated_at: string
}

interface AuthUser {
  id: number
  rol_id: number
}

interface AltaDetalles {
  nombre: string
  dni: string
  puesto_id: number
  fecha_incorporacion: string
  periodo_prueba?: boolean
  periodo_prueba_dias?: number | null
  carnet_manipulacion_alimentos: boolean
}

interface BajaDetalles {
  motivo_baja: string
  fecha_baja: string
}

interface VacacionesDetalles {
  fecha_desde: string
  fecha_hasta: string
  cantidad_dias: number
}

interface LicenciaDetalles {
  tipo_licencia: string
  fecha_desde: string
  fecha_hasta: string
  motivo: string
}

interface NovedadSueldoDetalles {
  sueldo_actual: number
  sueldo_nuevo: number
  fecha_vigencia: string
  motivo: string
}

interface ApercibimientoDetalles {
  fecha: string
  severidad: 'Leve' | 'Moderada' | 'Grave'
  motivo: string
}

interface DescuentoDetalles {
  motivo: string
  monto: number
  fecha: string
}

interface HorasExtrasDetalles {
  cantidad_horas: number
  fecha: string
  valor_hora?: number
  descripcion?: string
}

interface ResolveSideEffectsResult {
  personalId: number | null
  personalCreadoId: number | null
  liquidacionFinalEstado: 'Pendiente' | 'Generada' | 'No aplica' | 'Error'
}

interface ValidationContext {
  tipo: SolicitudTipo
  sucursalId: number
  personalId: number | null
  detalles: Record<string, unknown> | null
  solicitudId?: number
}

export function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

export function parseDetalles(detalles: unknown): Record<string, unknown> | null {
  if (!detalles) return null
  if (typeof detalles === 'string') {
    try {
      return JSON.parse(detalles) as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (typeof detalles === 'object') return detalles as Record<string, unknown>
  return null
}

function isValidDateString(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export async function isSuperAdmin(user: AuthUser): Promise<boolean> {
  const rolResult = (await query(`SELECT nombre FROM roles WHERE id = ?`, [user.rol_id])) as Array<{ nombre: string }>
  return Array.isArray(rolResult) && rolResult.length > 0 && rolResult[0].nombre === 'superadmin'
}

export async function hasPermission(user: AuthUser, permisoClave: string): Promise<boolean> {
  if (await isSuperAdmin(user)) return true

  const result = (await query(
    `SELECT 1
     FROM permisos p
     INNER JOIN roles_permisos rp ON rp.permiso_id = p.id
     WHERE rp.rol_id = ? AND p.clave = ?`,
    [user.rol_id, permisoClave],
  )) as Array<{ 1: number }>

  return Array.isArray(result) && result.length > 0
}

export async function verificarAccesoSucursal(user: AuthUser, sucursalId: number): Promise<boolean> {
  if (await isSuperAdmin(user)) return true
  const acceso = (await query(`SELECT 1 FROM usuarios_sucursales WHERE usuario_id = ? AND sucursal_id = ?`, [
    user.id,
    sucursalId,
  ])) as Array<{ 1: number }>
  return Array.isArray(acceso) && acceso.length > 0
}

async function validarPersonalAsignado(connection: PoolConnection, sucursalId: number, personalId: number, tipo: SolicitudTipo): Promise<void> {
  const [personalRows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, activo FROM personal WHERE id = ? AND sucursal_id = ? AND deleted_at IS NULL`,
    [personalId, sucursalId],
  )

  if (personalRows.length === 0) {
    throw new Error('El colaborador seleccionado no pertenece a la sucursal indicada')
  }

  const estaActivo = Number(personalRows[0].activo) === 1
  if (tipo === 'Bajas' && !estaActivo) {
    throw new Error('No se puede generar una baja para un colaborador ya inactivo')
  }
}

async function validarPuesto(connection: PoolConnection, sucursalId: number, puestoId: number): Promise<void> {
  const [puestoRows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM puestos WHERE id = ? AND sucursal_id = ? AND deleted_at IS NULL`,
    [puestoId, sucursalId],
  )

  if (puestoRows.length === 0) {
    throw new Error('El puesto seleccionado no existe en la sucursal indicada')
  }
}

function validarRangoFechas(fechaDesde: string, fechaHasta: string, mensaje: string): void {
  if (fechaDesde > fechaHasta) {
    throw new Error(mensaje)
  }
}

export async function validateSolicitudContext(
  connection: PoolConnection,
  context: ValidationContext,
): Promise<Record<string, unknown> | null> {
  const detalles = context.detalles

  if (context.personalId) {
    await validarPersonalAsignado(connection, context.sucursalId, context.personalId, context.tipo)
  }

  if (context.tipo === 'Altas') {
    if (!detalles) throw new Error('Las altas requieren datos completos del colaborador')
    const altaDetalles = detalles as Partial<AltaDetalles>
    if (!altaDetalles.nombre || !altaDetalles.dni || !altaDetalles.puesto_id || !altaDetalles.fecha_incorporacion) {
      throw new Error('Las altas requieren nombre, DNI, puesto y fecha de incorporación')
    }
    if (!isValidDateString(altaDetalles.fecha_incorporacion)) {
      throw new Error('La fecha de incorporación de la alta es inválida')
    }
    const periodoPrueba = Boolean(altaDetalles.periodo_prueba)
    const periodoPruebaDiasValue = Number(altaDetalles.periodo_prueba_dias ?? process.env.RRHH_PERIODO_PRUEBA_DIAS ?? 90)
    if (periodoPrueba && (!Number.isFinite(periodoPruebaDiasValue) || periodoPruebaDiasValue <= 0)) {
      throw new Error('La duración del período de prueba debe ser mayor a cero')
    }
    const periodoPruebaDias = periodoPrueba ? periodoPruebaDiasValue : null
    await validarPuesto(connection, context.sucursalId, Number(altaDetalles.puesto_id))

    return {
      nombre: String(altaDetalles.nombre).trim(),
      dni: String(altaDetalles.dni).trim(),
      puesto_id: Number(altaDetalles.puesto_id),
      fecha_incorporacion: altaDetalles.fecha_incorporacion,
      periodo_prueba: periodoPrueba,
      periodo_prueba_dias: periodoPruebaDias,
      carnet_manipulacion_alimentos: Boolean(altaDetalles.carnet_manipulacion_alimentos),
    }
  }

  if (context.tipo === 'Bajas') {
    if (!context.personalId) throw new Error('Las bajas requieren un colaborador asociado')
    if (!detalles) throw new Error('Las bajas requieren motivo y fecha de baja')
    const bajaDetalles = detalles as Partial<BajaDetalles>
    if (!bajaDetalles.motivo_baja || !bajaDetalles.fecha_baja) {
      throw new Error('Las bajas requieren motivo y fecha de baja')
    }
    if (!isValidDateString(bajaDetalles.fecha_baja)) {
      throw new Error('La fecha de baja es inválida')
    }

    return {
      motivo_baja: String(bajaDetalles.motivo_baja).trim(),
      fecha_baja: bajaDetalles.fecha_baja,
    }
  }

  if (context.tipo === 'Vacaciones') {
    if (!context.personalId) throw new Error('Las vacaciones requieren un colaborador asociado')
    if (!detalles) throw new Error('Las vacaciones requieren fechas y cantidad de días')
    const vacacionesDetalles = detalles as Partial<VacacionesDetalles>
    if (!vacacionesDetalles.fecha_desde || !vacacionesDetalles.fecha_hasta || vacacionesDetalles.cantidad_dias === undefined) {
      throw new Error('Las vacaciones requieren fecha desde, fecha hasta y cantidad de días')
    }
    if (!isValidDateString(vacacionesDetalles.fecha_desde) || !isValidDateString(vacacionesDetalles.fecha_hasta)) {
      throw new Error('Las fechas de vacaciones son inválidas')
    }
    validarRangoFechas(vacacionesDetalles.fecha_desde, vacacionesDetalles.fecha_hasta, 'La fecha desde no puede ser posterior a la fecha hasta en vacaciones')
    if (!isPositiveNumber(Number(vacacionesDetalles.cantidad_dias))) {
      throw new Error('La cantidad de días de vacaciones debe ser mayor a cero')
    }

    return {
      fecha_desde: vacacionesDetalles.fecha_desde,
      fecha_hasta: vacacionesDetalles.fecha_hasta,
      cantidad_dias: Number(vacacionesDetalles.cantidad_dias),
    }
  }

  if (context.tipo === 'Licencias') {
    if (!context.personalId) throw new Error('Las licencias requieren un colaborador asociado')
    if (!detalles) throw new Error('Las licencias requieren tipo, fechas y motivo')
    const licenciaDetalles = detalles as Partial<LicenciaDetalles>
    if (!licenciaDetalles.tipo_licencia || !licenciaDetalles.fecha_desde || !licenciaDetalles.fecha_hasta || !licenciaDetalles.motivo) {
      throw new Error('Las licencias requieren tipo, fechas y motivo')
    }
    if (!isValidDateString(licenciaDetalles.fecha_desde) || !isValidDateString(licenciaDetalles.fecha_hasta)) {
      throw new Error('Las fechas de licencia son inválidas')
    }
    validarRangoFechas(licenciaDetalles.fecha_desde, licenciaDetalles.fecha_hasta, 'La fecha desde no puede ser posterior a la fecha hasta en licencias')

    return {
      tipo_licencia: String(licenciaDetalles.tipo_licencia).trim(),
      fecha_desde: licenciaDetalles.fecha_desde,
      fecha_hasta: licenciaDetalles.fecha_hasta,
      motivo: String(licenciaDetalles.motivo).trim(),
    }
  }

  if (context.tipo === 'Novedades de sueldo') {
    if (!context.personalId) throw new Error('Las novedades de sueldo requieren un colaborador asociado')
    if (!detalles) throw new Error('Las novedades de sueldo requieren importes y fecha de vigencia')
    const sueldoDetalles = detalles as Partial<NovedadSueldoDetalles>
    if (
      sueldoDetalles.sueldo_actual === undefined ||
      sueldoDetalles.sueldo_nuevo === undefined ||
      !sueldoDetalles.fecha_vigencia ||
      !sueldoDetalles.motivo
    ) {
      throw new Error('Las novedades de sueldo requieren sueldo actual, sueldo nuevo, fecha de vigencia y motivo')
    }
    if (!isValidDateString(sueldoDetalles.fecha_vigencia)) {
      throw new Error('La fecha de vigencia de la novedad de sueldo es inválida')
    }

    const sueldoActual = Number(sueldoDetalles.sueldo_actual)
    const sueldoNuevo = Number(sueldoDetalles.sueldo_nuevo)
    if (!isPositiveNumber(sueldoActual) || !isPositiveNumber(sueldoNuevo)) {
      throw new Error('Los importes de la novedad de sueldo deben ser mayores a cero')
    }

    return {
      sueldo_actual: sueldoActual,
      sueldo_nuevo: sueldoNuevo,
      fecha_vigencia: sueldoDetalles.fecha_vigencia,
      motivo: String(sueldoDetalles.motivo).trim(),
    }
  }

  if (context.tipo === 'Apercibimientos') {
    if (!context.personalId) throw new Error('Los apercibimientos requieren un colaborador asociado')
    if (!detalles) throw new Error('Los apercibimientos requieren fecha, severidad y motivo')
    const apercibimientoDetalles = detalles as Partial<ApercibimientoDetalles>
    if (!apercibimientoDetalles.fecha || !apercibimientoDetalles.severidad || !apercibimientoDetalles.motivo) {
      throw new Error('Los apercibimientos requieren fecha, severidad y motivo')
    }
    if (!isValidDateString(apercibimientoDetalles.fecha)) {
      throw new Error('La fecha del apercibimiento es inválida')
    }

    return {
      fecha: apercibimientoDetalles.fecha,
      severidad: apercibimientoDetalles.severidad,
      motivo: String(apercibimientoDetalles.motivo).trim(),
    }
  }

  if (context.tipo === 'Descuentos') {
    if (!context.personalId) throw new Error('Los descuentos requieren un colaborador asociado')
    if (!detalles) throw new Error('Los descuentos requieren motivo, monto y fecha')
    const descuentoDetalles = detalles as Partial<DescuentoDetalles>
    if (!descuentoDetalles.motivo || !descuentoDetalles.monto || !descuentoDetalles.fecha) {
      throw new Error('Los descuentos requieren motivo, monto y fecha')
    }
    if (!isValidDateString(descuentoDetalles.fecha)) {
      throw new Error('La fecha del descuento es inválida')
    }
    const monto = Number(descuentoDetalles.monto)
    if (!isPositiveNumber(monto)) {
      throw new Error('El monto del descuento debe ser mayor a cero')
    }

    return {
      motivo: String(descuentoDetalles.motivo).trim(),
      monto,
      fecha: descuentoDetalles.fecha,
    }
  }

  if (context.tipo === 'Horas extras') {
    if (!context.personalId) throw new Error('Las horas extras requieren un colaborador asociado')
    if (!detalles) throw new Error('Las horas extras requieren cantidad de horas y fecha')
    const horasDetalles = detalles as Partial<HorasExtrasDetalles>
    if (!horasDetalles.cantidad_horas || !horasDetalles.fecha) {
      throw new Error('Las horas extras requieren cantidad de horas y fecha')
    }
    if (!isValidDateString(horasDetalles.fecha)) {
      throw new Error('La fecha de horas extras es inválida')
    }
    const cantidadHoras = Number(horasDetalles.cantidad_horas)
    if (!isPositiveNumber(cantidadHoras)) {
      throw new Error('La cantidad de horas extras debe ser mayor a cero')
    }

    return {
      cantidad_horas: cantidadHoras,
      fecha: horasDetalles.fecha,
      ...(horasDetalles.valor_hora != null && { valor_hora: Number(horasDetalles.valor_hora) }),
      ...(horasDetalles.descripcion && { descripcion: String(horasDetalles.descripcion).trim() }),
    }
  }

  return detalles
}

export async function insertHistorial(
  connection: PoolConnection,
  solicitudId: number,
  personalId: number | null,
  usuarioId: number | null,
  evento: string,
  detalle: string | null,
): Promise<void> {
  await connection.execute(
    `INSERT INTO rrhh_solicitudes_historial (solicitud_id, personal_id, usuario_id, evento, detalle)
     VALUES (?, ?, ?, ?, ?)`,
    [solicitudId, personalId, usuarioId, evento, detalle],
  )
}

export async function getSolicitudHistorial(solicitudId: number): Promise<SolicitudHistorialItem[]> {
  const rows = (await query(
    `SELECT h.id, h.solicitud_id, h.personal_id, h.usuario_id, u.nombre AS usuario_nombre, h.evento, h.detalle, h.created_at
     FROM rrhh_solicitudes_historial h
     LEFT JOIN usuarios u ON u.id = h.usuario_id
     WHERE h.solicitud_id = ?
     ORDER BY h.created_at ASC, h.id ASC`,
    [solicitudId],
  )) as SolicitudHistorialItem[]

  return rows
}

export async function enrichSolicitud(row: SolicitudRow): Promise<SolicitudRow & { historial: SolicitudHistorialItem[] }> {
  return {
    ...row,
    detalles: parseDetalles(row.detalles),
    historial: await getSolicitudHistorial(row.id),
  }
}

export async function resolveSolicitudSideEffects(
  connection: PoolConnection,
  solicitud: SolicitudRow,
  usuarioId: number,
): Promise<ResolveSideEffectsResult> {
  let personalId = solicitud.personal_id
  let personalCreadoId = solicitud.personal_creado_id
  let liquidacionFinalEstado: ResolveSideEffectsResult['liquidacionFinalEstado'] = 'No aplica'

  if (solicitud.tipo === 'Altas') {
    const detalles = parseDetalles(solicitud.detalles) as AltaDetalles | null
    if (!detalles) {
      throw new Error('La solicitud de alta no tiene detalles válidos')
    }

    await validarPuesto(connection, solicitud.sucursal_id, detalles.puesto_id)

    const [dniCheck] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM personal WHERE dni = ? LIMIT 1`,
      [detalles.dni.trim()],
    )
    if (dniCheck.length > 0) {
      throw new Error('Ya existe un colaborador con ese DNI')
    }

    const [lastRow] = await connection.execute<RowDataPacket[]>(`SELECT MAX(CAST(legajo AS UNSIGNED)) AS max_num FROM personal`)
    const maxNum = lastRow.length > 0 && lastRow[0].max_num != null ? Number(lastRow[0].max_num) : 0
    const nuevoLegajo = String(maxNum + 1).padStart(6, '0')

    const [insertResult] = await connection.execute(
      `INSERT INTO personal
       (legajo, nombre, dni, puesto_id, sucursal_id, fecha_incorporacion, periodo_prueba, periodo_prueba_dias, carnet_manipulacion_alimentos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nuevoLegajo,
        detalles.nombre.trim(),
        detalles.dni.trim(),
        detalles.puesto_id,
        solicitud.sucursal_id,
        detalles.fecha_incorporacion,
        detalles.periodo_prueba ? 1 : 0,
        detalles.periodo_prueba ? detalles.periodo_prueba_dias ?? null : null,
        detalles.carnet_manipulacion_alimentos ? 1 : 0,
      ],
    )

    const createdId = Number((insertResult as { insertId: number }).insertId)
    personalId = createdId
    personalCreadoId = createdId

    await insertHistorial(connection, solicitud.id, createdId, usuarioId, 'Legajo creado', `Legajo generado automáticamente para ${detalles.nombre.trim()}.`)
  }

  if (solicitud.tipo === 'Bajas') {
    if (!solicitud.personal_id) {
      throw new Error('La solicitud de baja no tiene colaborador asociado')
    }

    const [personalRows] = await connection.execute<RowDataPacket[]>(
      `SELECT activo FROM personal WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [solicitud.personal_id],
    )

    if (personalRows.length === 0) {
      throw new Error('El colaborador de la baja ya no existe')
    }

    if (Number(personalRows[0].activo) !== 1) {
      throw new Error('El colaborador ya se encuentra inactivo')
    }

    await connection.execute(`UPDATE personal SET activo = 0 WHERE id = ? AND deleted_at IS NULL`, [solicitud.personal_id])
    await insertHistorial(connection, solicitud.id, solicitud.personal_id, usuarioId, 'Legajo desactivado', 'Colaborador desactivado automáticamente por aprobación de baja.')

    await connection.execute(
      `INSERT INTO rrhh_liquidaciones_finales (solicitud_id, personal_id, estado, detalle)
       VALUES (?, ?, 'Generada', ?)
       ON DUPLICATE KEY UPDATE estado = VALUES(estado), detalle = VALUES(detalle), updated_at = NOW()`,
      [solicitud.id, solicitud.personal_id, 'Liquidación final generada automáticamente desde la solicitud aprobada.'],
    )
    await insertHistorial(connection, solicitud.id, solicitud.personal_id, usuarioId, 'Liquidacion final generada', 'Se generó la liquidación final automáticamente.')
    liquidacionFinalEstado = 'Generada'
  }

  return { personalId, personalCreadoId, liquidacionFinalEstado }
}

export const SOLICITUD_SELECT = `
  SELECT s.*,
         suc.nombre AS sucursal_nombre,
         p.nombre AS personal_nombre,
         p.legajo,
         p.dni,
         u.nombre AS usuario_nombre,
         ur.nombre AS resuelto_por_nombre
  FROM rrhh_solicitudes s
  INNER JOIN sucursales suc ON s.sucursal_id = suc.id
  LEFT JOIN personal p ON COALESCE(s.personal_creado_id, s.personal_id) = p.id
  INNER JOIN usuarios u ON s.usuario_id = u.id
  LEFT JOIN usuarios ur ON s.resuelto_por_usuario_id = ur.id
`
