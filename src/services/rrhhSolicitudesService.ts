import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { query } from '../config/database'
import { getMotivoBajaActivoEnSucursal } from './rrhhMotivosBajaService'

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
  personal_email: string | null
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

interface AltaAdjuntoSlot {
  url: string
  nombre_original?: string | null
}

interface AltaDetalles {
  nombre: string
  dni: string
  cuil: string
  domicilio: string
  domicilio_dni: string
  fecha_nacimiento: string
  telefono: string
  email: string | null
  banco?: string | null
  cbu?: string | null
  puesto_id: number
  fecha_incorporacion: string
  fecha_inicio_cobro_oficina: string
  jornada_semanal_dias: number
  jornada_diaria_horas_texto: string
  propuesta_economica: number
  beneficios: string
  otras_observaciones_alta?: string | null
  condicion_laboral: 1 | 2
  fecha_alta_temprana: string | null
  periodo_prueba?: boolean
  periodo_prueba_dias?: number | null
  carnet_manipulacion_alimentos: boolean
  carnet_adjunto: AltaAdjuntoSlot | null
  carnet_fecha_vencimiento: string | null
  adjuntos: {
    dni_frente_dorso: AltaAdjuntoSlot
    ddjj_domicilio: AltaAdjuntoSlot
    descripcion_puesto_firmada: AltaAdjuntoSlot
    foto_colaborador: AltaAdjuntoSlot
  }
}

interface BajaDetalles {
  motivo_baja_id?: unknown
  motivo_baja_nombre?: unknown
  motivo_baja_detalle?: unknown
  fecha_baja: string
  liquidacion_empleado?: unknown
  carta_documento_adjunto?: unknown
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

interface EmpleadoNovedad {
  personal_id: number
  personal_nombre: string
  cambio_puesto: boolean
  nuevo_puesto_id: number | null
  fecha_alta_puesto: string | null
  horas_trabajadas: number | null
  horas_feriados: number | null
  horas_extras_autorizadas: boolean
  horas_extras_cantidad: number | null
  incentivos: Array<{ incentivo_id: number; nombre: string; aplica: boolean }>
  apercibimiento: { tiene: boolean; motivo: string | null; archivo_url: string | null; archivo_nombre: string | null }
  suspension: { tiene: boolean; motivo: string | null; archivo_url: string | null; archivo_nombre: string | null }
  descuento: { tiene: boolean; monto: number | null; motivo: string | null }
  ausencias_justificadas: {
    tiene: boolean
    cantidad: number | null
    unidad: 'horas' | 'minutos'
    motivo: string | null
  }
  ausencias_injustificadas: { cantidad: number | null; unidad: 'horas' | 'minutos'; motivo: string | null }
  tardanzas: { tiene: boolean; cantidad: number | null; unidad: 'horas' | 'minutos'; motivo: string | null }
  observaciones: string | null
}

interface NovedadSueldoDetalles {
  area_id: number
  mes: number
  anio: number
  empleados: EmpleadoNovedad[]
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
  /** Detalles previos del registro (p. ej. al editar) para fusionar adjuntos no reenviados */
  detallesAnteriores?: Record<string, unknown> | null
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

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function cleanTrim(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

function parseAltaAdjunto(value: unknown): AltaAdjuntoSlot | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  const url = cleanTrim(o.url)
  if (!url) return null
  const nombreRaw = o.nombre_original
  const nombre_original = typeof nombreRaw === 'string' && nombreRaw.trim() ? nombreRaw.trim() : null
  return { url, nombre_original }
}

function isValidEmail(value: string | null): boolean {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
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

async function validarPersonalAsignado(
  connection: PoolConnection,
  sucursalId: number,
  personalId: number,
  tipo: SolicitudTipo,
): Promise<void> {
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

async function validarPuesto(connection: PoolConnection, puestoId: number): Promise<void> {
  const [puestoRows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM puestos WHERE id = ? AND deleted_at IS NULL`,
    [puestoId],
  )

  if (puestoRows.length === 0) {
    throw new Error('El puesto seleccionado no existe o fue eliminado')
  }
}

function validarRangoFechas(fechaDesde: string, fechaHasta: string, mensaje: string): void {
  if (fechaDesde > fechaHasta) {
    throw new Error(mensaje)
  }
}

function objetoEmpleadoRegistro(val: unknown): Record<string, unknown> | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null
  return val as Record<string, unknown>
}

/** Mismas reglas condicionales que en novedades de sueldo (un ítem empleados). */
function validarLiquidacionEmpNovedadCliente(emp: Record<string, unknown>): void {
  const nombreEtiqueta = cleanTrim(emp.personal_nombre) || 'el colaborador'

  const cambioPuesto = Boolean(emp.cambio_puesto)
  const nuevoPuestoId = normalizeNumber(emp.nuevo_puesto_id)
  if (cambioPuesto && !nuevoPuestoId) {
    throw new Error(`Seleccione el nuevo puesto de ${nombreEtiqueta}`)
  }

  const apercibimiento = objetoEmpleadoRegistro(emp.apercibimiento)
  if (Boolean(apercibimiento?.tiene) && !normalizeOptionalText(apercibimiento?.motivo)) {
    throw new Error(`Ingrese el motivo del apercibimiento de ${nombreEtiqueta}`)
  }

  const suspension = objetoEmpleadoRegistro(emp.suspension)
  if (Boolean(suspension?.tiene) && !normalizeOptionalText(suspension?.motivo)) {
    throw new Error(`Ingrese el motivo de la suspensión de ${nombreEtiqueta}`)
  }

  const descuento = objetoEmpleadoRegistro(emp.descuento)
  if (Boolean(descuento?.tiene) && !normalizeOptionalText(descuento?.motivo)) {
    throw new Error(`Ingrese el motivo del descuento de ${nombreEtiqueta}`)
  }

  const tardanzas = objetoEmpleadoRegistro(emp.tardanzas)
  if (Boolean(tardanzas?.tiene)) {
    const cant = normalizeNumber(tardanzas?.cantidad)
    if (!cant || cant <= 0) {
      throw new Error(`Ingrese la cantidad de tardanza de ${nombreEtiqueta}`)
    }
  }

  const ausJ = objetoEmpleadoRegistro(emp.ausencias_justificadas)
  if (Boolean(ausJ?.tiene)) {
    const cant = normalizeNumber(ausJ?.cantidad)
    if (!cant || cant <= 0) {
      throw new Error(`Indique cantidad en ausencias justificadas de ${nombreEtiqueta}`)
    }
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
    const a = detalles as Partial<AltaDetalles>
    const nombre = cleanTrim(a.nombre)
    const dni = cleanTrim(a.dni)
    const cuilParsed = onlyDigits(cleanTrim(a.cuil != null ? String(a.cuil) : ''))
    const domicilio = cleanTrim(a.domicilio)
    const fechaNacimiento = cleanTrim(a.fecha_nacimiento)
    const telefono = cleanTrim(a.telefono)
    const fechaInicioCobro = cleanTrim(a.fecha_inicio_cobro_oficina)
    const jornadaHorasTexto = cleanTrim(a.jornada_diaria_horas_texto)

    const JORNADA_DIAS = Number(a.jornada_semanal_dias)
    const PROPUESTA = Number(a.propuesta_economica)

    const ADJUNTOS_LABELS = {
      dni_frente_dorso: 'DNI (ambos lados)',
      ddjj_domicilio: 'Declaración jurada de domicilio',
      descripcion_puesto_firmada: 'Descripción de puesto firmada',
      foto_colaborador: 'Foto del colaborador',
    } as const

    if (!nombre) throw new Error('Ingrese nombres y apellidos del colaborador')
    if (!dni) throw new Error('Ingrese el DNI del colaborador')
    if (cuilParsed.length < 10 || cuilParsed.length > 13) throw new Error('Ingrese un CUIL o CUIT válido')
    if (!domicilio) throw new Error('Ingrese la dirección real')
    const domicilioDni = cleanTrim(a.domicilio_dni)
    if (!domicilioDni) throw new Error('Ingrese la dirección según consta en el DNI')
    if (!fechaNacimiento) throw new Error('Ingrese la fecha de nacimiento')
    if (!isValidDateString(fechaNacimiento)) throw new Error('La fecha de nacimiento es inválida')
    if (!telefono) throw new Error('Ingrese el teléfono')

    const email = normalizeEmail(a.email)
    if (!email || !isValidEmail(email)) {
      throw new Error('Ingrese un correo electrónico válido')
    }

    if (!a.puesto_id || !a.fecha_incorporacion) {
      throw new Error('Seleccione puesto y fecha de inicio de la relación laboral')
    }
    if (!isValidDateString(a.fecha_incorporacion)) {
      throw new Error('La fecha de inicio de la relación laboral es inválida')
    }

    const bancoNombre = cleanTrim(a.banco) || null
    const cbuTexto = cleanTrim(a.cbu)
    let cbu: string | null = null
    if (cbuTexto) {
      cbu = onlyDigits(cbuTexto)
      if (cbu.length !== 22) throw new Error('El CBU o CVU debe tener 22 dígitos')
      if (!bancoNombre) throw new Error('Si informa CBU, indique la entidad bancaria')
    }

    if (!Number.isFinite(JORNADA_DIAS) || JORNADA_DIAS < 1 || JORNADA_DIAS > 7) {
      throw new Error('La jornada semanal debe ser entre 1 y 7 días')
    }
    if (!jornadaHorasTexto) {
      throw new Error('Describa la jornada diaria (ej.: 7 a 8 horas)')
    }

    if (!fechaInicioCobro) throw new Error('Ingrese la fecha de inicio de cobro en oficina')
    if (!isValidDateString(fechaInicioCobro)) {
      throw new Error('La fecha de inicio de cobro en oficina es inválida')
    }

    if (!Number.isFinite(PROPUESTA) || PROPUESTA <= 0) {
      throw new Error('Ingrese una propuesta económica válida mayor a cero')
    }

    const beneficios = cleanTrim(a.beneficios)
    if (!beneficios) {
      throw new Error('Indique los beneficios otorgados')
    }

    const condicionLaboral = Number(a.condicion_laboral)
    if (!Number.isFinite(condicionLaboral) || (condicionLaboral !== 1 && condicionLaboral !== 2)) {
      throw new Error('Seleccione la condición laboral (1 o 2)')
    }
    let fechaAltaTemprana: string | null = null
    if (condicionLaboral === 1) {
      const fa = cleanTrim(a.fecha_alta_temprana)
      if (!isValidDateString(fa)) {
        throw new Error('Ingrese la fecha de alta temprana (condición laboral 1)')
      }
      fechaAltaTemprana = fa
    }

    const tieneCarnet = Boolean(a.carnet_manipulacion_alimentos)
    let carnetAdjunto: AltaAdjuntoSlot | null = null
    let carnetVencimiento: string | null = null
    if (tieneCarnet) {
      const incomingCarnet = parseAltaAdjunto(a.carnet_adjunto)
      const prevCarnet =
        context.detallesAnteriores && typeof context.detallesAnteriores === 'object'
          ? parseAltaAdjunto((context.detallesAnteriores as Record<string, unknown>).carnet_adjunto)
          : undefined
      carnetAdjunto = incomingCarnet ?? prevCarnet ?? null
      if (!carnetAdjunto) {
        throw new Error('Adjunte el archivo del carnet de manipulación de alimentos')
      }
      let vRaw = cleanTrim(a.carnet_fecha_vencimiento)
      if (
        !vRaw &&
        context.detallesAnteriores &&
        typeof context.detallesAnteriores === 'object'
      ) {
        vRaw = cleanTrim((context.detallesAnteriores as Record<string, unknown>).carnet_fecha_vencimiento)
      }
      if (!isValidDateString(vRaw)) {
        throw new Error('Indique una fecha de vencimiento válida para el carnet de manipulación')
      }
      carnetVencimiento = vRaw
    }

    const adjuntosFuente = a.adjuntos as Record<string, unknown> | undefined
    const prevAdj =
      context.detallesAnteriores && typeof context.detallesAnteriores === 'object'
        ? (context.detallesAnteriores as Record<string, unknown>).adjuntos as Record<string, unknown> | undefined
        : undefined
    const adjuntos: AltaDetalles['adjuntos'] = {} as AltaDetalles['adjuntos']
    for (const key of ['dni_frente_dorso', 'ddjj_domicilio', 'descripcion_puesto_firmada', 'foto_colaborador'] as const) {
      const incoming = parseAltaAdjunto(adjuntosFuente?.[key])
      const persisted = parseAltaAdjunto(prevAdj?.[key])
      const slot = incoming ?? persisted
      if (!slot) {
        throw new Error(`Falta subir escaneado: ${ADJUNTOS_LABELS[key]}`)
      }
      adjuntos[key] = slot
    }

    const periodoPrueba = Boolean(a.periodo_prueba)
    const periodoPruebaDiasValue = Number(a.periodo_prueba_dias ?? process.env.RRHH_PERIODO_PRUEBA_DIAS ?? 90)
    if (periodoPrueba && (!Number.isFinite(periodoPruebaDiasValue) || periodoPruebaDiasValue <= 0)) {
      throw new Error('La duración del período de prueba debe ser mayor a cero')
    }
    const periodoPruebaDias = periodoPrueba ? periodoPruebaDiasValue : null

    await validarPuesto(connection, Number(a.puesto_id))

    const otrasObs = normalizeOptionalText(a.otras_observaciones_alta)

    return {
      nombre,
      dni,
      cuil: cuilParsed,
      domicilio,
      domicilio_dni: domicilioDni,
      fecha_nacimiento: fechaNacimiento,
      telefono,
      email,
      banco: bancoNombre,
      cbu,
      puesto_id: Number(a.puesto_id),
      fecha_incorporacion: a.fecha_incorporacion,
      fecha_inicio_cobro_oficina: fechaInicioCobro,
      jornada_semanal_dias: JORNADA_DIAS,
      jornada_diaria_horas_texto: jornadaHorasTexto,
      propuesta_economica: PROPUESTA,
      beneficios,
      otras_observaciones_alta: otrasObs,
      condicion_laboral: condicionLaboral as 1 | 2,
      fecha_alta_temprana: fechaAltaTemprana,
      periodo_prueba: periodoPrueba,
      periodo_prueba_dias: periodoPruebaDias,
      carnet_manipulacion_alimentos: tieneCarnet,
      carnet_adjunto: tieneCarnet ? carnetAdjunto : null,
      carnet_fecha_vencimiento: tieneCarnet ? carnetVencimiento : null,
      adjuntos,
    }
  }

  if (context.tipo === 'Bajas') {
    if (!context.personalId) throw new Error('Las bajas requieren un colaborador asociado')
    if (!detalles) throw new Error('Las bajas requieren los datos completos de la ficha RRHH 002')

    const b = detalles as Partial<BajaDetalles> & Record<string, unknown>

    const motivoId = normalizeNumber(b.motivo_baja_id)
    if (!motivoId || motivoId <= 0) {
      throw new Error('Seleccione un motivo de baja del catálogo')
    }

    const motivoCatalogo = await getMotivoBajaActivoEnSucursal(connection, context.sucursalId, motivoId)
    if (!motivoCatalogo) {
      throw new Error('Motivo de baja inválido para esta sucursal')
    }

    const fechaBaja = cleanTrim(b.fecha_baja)
    if (!fechaBaja || !isValidDateString(fechaBaja)) {
      throw new Error('La fecha de baja es inválida')
    }

    const liqRaw = objetoEmpleadoRegistro(b.liquidacion_empleado)
    if (!liqRaw) {
      throw new Error('Complete los datos laborales (mismo formato que novedades de sueldo)')
    }

    const liqPid = normalizeNumber(liqRaw.personal_id)
    if (liqPid !== context.personalId) {
      throw new Error('Los datos laborales deben corresponder al colaborador seleccionado')
    }

    validarLiquidacionEmpNovedadCliente(liqRaw)

    const incomingCarta = parseAltaAdjunto(b.carta_documento_adjunto)
    const prevCarta =
      context.detallesAnteriores && typeof context.detallesAnteriores === 'object'
        ? parseAltaAdjunto((context.detallesAnteriores as Record<string, unknown>).carta_documento_adjunto)
        : undefined
    const cartaDoc = incomingCarta ?? prevCarta ?? null
    if (!cartaDoc?.url) {
      throw new Error('Adjunte la carta documento en PDF')
    }

    const liquidacionGuardada = JSON.parse(JSON.stringify(liqRaw)) as Record<string, unknown>

    return {
      motivo_baja_id: motivoId,
      motivo_baja_nombre: motivoCatalogo.nombre,
      motivo_baja_detalle: normalizeOptionalText(b.motivo_baja_detalle),
      fecha_baja: fechaBaja,
      liquidacion_empleado: liquidacionGuardada,
      carta_documento_adjunto: cartaDoc,
    }
  }

  if (context.tipo === 'Vacaciones') {
    if (!context.personalId) throw new Error('Las vacaciones requieren un colaborador asociado')
    if (!detalles) throw new Error('Las vacaciones requieren fechas y cantidad de días')
    const vacacionesDetalles = detalles as Partial<VacacionesDetalles>
    if (
      !vacacionesDetalles.fecha_desde ||
      !vacacionesDetalles.fecha_hasta ||
      vacacionesDetalles.cantidad_dias === undefined
    ) {
      throw new Error('Las vacaciones requieren fecha desde, fecha hasta y cantidad de días')
    }
    if (!isValidDateString(vacacionesDetalles.fecha_desde) || !isValidDateString(vacacionesDetalles.fecha_hasta)) {
      throw new Error('Las fechas de vacaciones son inválidas')
    }
    validarRangoFechas(
      vacacionesDetalles.fecha_desde,
      vacacionesDetalles.fecha_hasta,
      'La fecha desde no puede ser posterior a la fecha hasta en vacaciones',
    )
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
    if (
      !licenciaDetalles.tipo_licencia ||
      !licenciaDetalles.fecha_desde ||
      !licenciaDetalles.fecha_hasta ||
      !licenciaDetalles.motivo
    ) {
      throw new Error('Las licencias requieren tipo, fechas y motivo')
    }
    if (!isValidDateString(licenciaDetalles.fecha_desde) || !isValidDateString(licenciaDetalles.fecha_hasta)) {
      throw new Error('Las fechas de licencia son inválidas')
    }
    validarRangoFechas(
      licenciaDetalles.fecha_desde,
      licenciaDetalles.fecha_hasta,
      'La fecha desde no puede ser posterior a la fecha hasta en licencias',
    )

    return {
      tipo_licencia: String(licenciaDetalles.tipo_licencia).trim(),
      fecha_desde: licenciaDetalles.fecha_desde,
      fecha_hasta: licenciaDetalles.fecha_hasta,
      motivo: String(licenciaDetalles.motivo).trim(),
    }
  }

  if (context.tipo === 'Novedades de sueldo') {
    if (!detalles) throw new Error('Las novedades de sueldo requieren área, mes y año')
    const d = detalles as Partial<NovedadSueldoDetalles>
    if (!d.area_id || !d.mes || !d.anio) {
      throw new Error('Las novedades de sueldo requieren área, mes y año')
    }
    const mes = Number(d.mes)
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new Error('El mes de la novedad de sueldo es inválido')
    }
    if (!Array.isArray(d.empleados) || d.empleados.length === 0) {
      throw new Error('Las novedades de sueldo requieren al menos un empleado')
    }

    return {
      area_id: Number(d.area_id),
      mes,
      anio: Number(d.anio),
      empleados: d.empleados,
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

  if (context.tipo === 'Suspensiones') {
    if (!context.personalId) throw new Error('Las suspensiones requieren un colaborador asociado')
    if (!detalles) throw new Error('Las suspensiones requieren fechas y motivo')
    const d = detalles as Record<string, unknown>
    const fechaDesde = cleanTrim(d.fecha_desde)
    const fechaHasta = cleanTrim(d.fecha_hasta)
    const motivo = cleanTrim(d.motivo)
    if (!fechaDesde || !isValidDateString(fechaDesde)) throw new Error('La fecha de inicio de la suspensión es inválida')
    if (!fechaHasta || !isValidDateString(fechaHasta)) throw new Error('La fecha de fin de la suspensión es inválida')
    validarRangoFechas(fechaDesde, fechaHasta, 'La fecha de inicio no puede ser posterior a la fecha de fin de la suspensión')
    if (!motivo) throw new Error('Ingrese el motivo de la suspensión')
    return { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, motivo }
  }

  if (context.tipo === 'Capacitaciones') {
    if (!detalles) throw new Error('Las capacitaciones requieren tema y fecha')
    const d = detalles as Record<string, unknown>
    const tema = cleanTrim(d.tema)
    const fecha = cleanTrim(d.fecha)
    if (!tema) throw new Error('Ingrese el tema de la capacitación')
    if (!fecha || !isValidDateString(fecha)) throw new Error('La fecha de la capacitación es inválida')
    return { tema, fecha, descripcion: normalizeOptionalText(d.descripcion) }
  }

  if (context.tipo === 'Pedido de uniforme') {
    if (!context.personalId) throw new Error('Los pedidos de uniforme requieren un colaborador asociado')
    if (!detalles) throw new Error('El pedido de uniforme requiere talle e items')
    const d = detalles as Record<string, unknown>
    const talle = cleanTrim(d.talle)
    const items = cleanTrim(d.items)
    if (!talle) throw new Error('Ingrese el talle del colaborador')
    if (!items) throw new Error('Ingrese los items solicitados')
    return { talle, items, observaciones: normalizeOptionalText(d.observaciones) }
  }

  if (context.tipo === 'Adelantos') {
    if (!context.personalId) throw new Error('Los adelantos requieren un colaborador asociado')
    if (!detalles) throw new Error('Los adelantos requieren monto, fecha y motivo')
    const d = detalles as Record<string, unknown>
    const monto = Number(d.monto)
    if (!isPositiveNumber(monto)) throw new Error('El monto del adelanto debe ser mayor a cero')
    const fecha = cleanTrim(d.fecha)
    if (!fecha || !isValidDateString(fecha)) throw new Error('La fecha del adelanto es inválida')
    const motivo = cleanTrim(d.motivo)
    if (!motivo) throw new Error('Ingrese el motivo del adelanto')
    return { monto, fecha, motivo }
  }

  if (context.tipo === 'Incentivos y premios') {
    if (!context.personalId) throw new Error('Los incentivos y premios requieren un colaborador asociado')
    if (!detalles) throw new Error('Los incentivos y premios requieren descripción y fecha')
    const d = detalles as Record<string, unknown>
    const descripcion = cleanTrim(d.descripcion)
    if (!descripcion) throw new Error('Ingrese la descripción del incentivo o premio')
    const fecha = cleanTrim(d.fecha)
    if (!fecha || !isValidDateString(fecha)) throw new Error('La fecha del incentivo o premio es inválida')
    const montoRaw = d.monto != null && d.monto !== '' ? Number(d.monto) : null
    if (montoRaw !== null && !isPositiveNumber(montoRaw)) throw new Error('El monto del incentivo debe ser mayor a cero')
    return { descripcion, fecha, monto: montoRaw }
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

export async function enrichSolicitud(
  row: SolicitudRow,
): Promise<SolicitudRow & { historial: SolicitudHistorialItem[] }> {
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

    await validarPuesto(connection, detalles.puesto_id)

    const [dniCheck] = await connection.execute<RowDataPacket[]>(`SELECT id FROM personal WHERE dni = ? LIMIT 1`, [
      detalles.dni.trim(),
    ])
    if (dniCheck.length > 0) {
      throw new Error('Ya existe un colaborador con ese DNI')
    }

    const [lastRow] = await connection.execute<RowDataPacket[]>(
      `SELECT MAX(CAST(legajo AS UNSIGNED)) AS max_num FROM personal`,
    )
    const maxNum = lastRow.length > 0 && lastRow[0].max_num != null ? Number(lastRow[0].max_num) : 0
    const nuevoLegajo = String(maxNum + 1).padStart(6, '0')

    const [insertResult] = await connection.execute(
      `INSERT INTO personal
       (legajo, nombre, dni, cuil, email, telefono, fecha_nacimiento, domicilio_real, domicilio_dni,
        puesto_id, sucursal_id, fecha_incorporacion, fecha_inicio_cobro,
        periodo_prueba, periodo_prueba_dias, jornada_semanal_dias, jornada_diaria_horas,
        propuesta_economica, beneficios, condicion_laboral, fecha_alta_temprana, banco, cbu,
        carnet_manipulacion_alimentos, carnet_archivo_url, carnet_archivo_nombre, carnet_vencimiento,
        solicitud_alta_id, datos_alta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nuevoLegajo,
        detalles.nombre.trim(),
        detalles.dni.trim(),
        detalles.cuil?.trim() ?? null,
        detalles.email ?? null,
        detalles.telefono.trim(),
        detalles.fecha_nacimiento,
        detalles.domicilio.trim(),
        detalles.domicilio_dni.trim(),
        detalles.puesto_id,
        solicitud.sucursal_id,
        detalles.fecha_incorporacion,
        detalles.fecha_inicio_cobro_oficina,
        detalles.periodo_prueba ? 1 : 0,
        detalles.periodo_prueba && detalles.periodo_prueba_dias ? detalles.periodo_prueba_dias : null,
        detalles.jornada_semanal_dias,
        detalles.jornada_diaria_horas_texto,
        detalles.propuesta_economica,
        detalles.beneficios,
        detalles.condicion_laboral,
        detalles.fecha_alta_temprana ?? null,
        detalles.banco ?? null,
        detalles.cbu ?? null,
        detalles.carnet_manipulacion_alimentos ? 1 : 0,
        detalles.carnet_manipulacion_alimentos && detalles.carnet_adjunto ? detalles.carnet_adjunto.url : null,
        detalles.carnet_manipulacion_alimentos && detalles.carnet_adjunto ? detalles.carnet_adjunto.nombre_original ?? null : null,
        detalles.carnet_manipulacion_alimentos ? detalles.carnet_fecha_vencimiento : null,
        solicitud.id,
        JSON.stringify(detalles),
      ],
    )

    const createdId = Number((insertResult as { insertId: number }).insertId)
    personalId = createdId
    personalCreadoId = createdId

    await insertHistorial(
      connection,
      solicitud.id,
      createdId,
      usuarioId,
      'Legajo creado',
      `Legajo generado automáticamente para ${detalles.nombre.trim()}.`,
    )
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

    await connection.execute(`UPDATE personal SET activo = 0 WHERE id = ? AND deleted_at IS NULL`, [
      solicitud.personal_id,
    ])
    await insertHistorial(
      connection,
      solicitud.id,
      solicitud.personal_id,
      usuarioId,
      'Legajo desactivado',
      'Colaborador desactivado automáticamente por aprobación de baja.',
    )

    await connection.execute(
      `INSERT INTO rrhh_liquidaciones_finales (solicitud_id, personal_id, estado, detalle)
       VALUES (?, ?, 'Generada', ?)
       ON DUPLICATE KEY UPDATE estado = VALUES(estado), detalle = VALUES(detalle), updated_at = NOW()`,
      [solicitud.id, solicitud.personal_id, 'Liquidación final generada automáticamente desde la solicitud aprobada.'],
    )
    await insertHistorial(
      connection,
      solicitud.id,
      solicitud.personal_id,
      usuarioId,
      'Liquidacion final generada',
      'Se generó la liquidación final automáticamente.',
    )
    liquidacionFinalEstado = 'Generada'
  }

  if (solicitud.tipo === 'Novedades de sueldo') {
    const detalles = parseDetalles(solicitud.detalles) as NovedadSueldoDetalles | null
    if (detalles?.empleados) {
      for (const emp of detalles.empleados) {
        if (emp.cambio_puesto && emp.nuevo_puesto_id != null) {
          await connection.execute(
            `UPDATE personal SET puesto_id = ? WHERE id = ? AND deleted_at IS NULL`,
            [emp.nuevo_puesto_id, emp.personal_id],
          )
          await insertHistorial(
            connection,
            solicitud.id,
            emp.personal_id,
            usuarioId,
            'Puesto actualizado',
            `Puesto actualizado a ID ${emp.nuevo_puesto_id} por aprobación de novedad de sueldo.`,
          )
        }
      }
    }
  }

  return { personalId, personalCreadoId, liquidacionFinalEstado }
}

export const SOLICITUD_SELECT = `
  SELECT s.*,
         suc.nombre AS sucursal_nombre,
         p.nombre AS personal_nombre,
         p.email AS personal_email,
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
