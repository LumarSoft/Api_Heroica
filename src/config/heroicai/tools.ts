import type OpenAI from 'openai'
import { query } from '../database'
import { assertPermiso, getSucursalesDelUsuario, type HeroicaiUser } from '../../utils/heroicaiGuards'

/**
 * ============================================================
 *  HEROICAI — CATÁLOGO DE HERRAMIENTAS (SOLO LECTURA)
 * ============================================================
 *
 * Cada herramienta es un wrapper fino sobre queries de solo lectura.
 * REGLAS DE ORO:
 *   1. El LLM nunca genera SQL: solo elige entre estas funciones.
 *   2. Toda tool corre COMO el usuario logueado (recibe HeroicaiUser).
 *   3. Toda tool valida permiso (assertPermiso) y scoping por sucursal
 *      (resolverSucursalesPermitidas) antes de tocar la base.
 *   4. Devuelven JSON compacto y ya formateado (sin filas crudas gigantes).
 * ============================================================
 */

// Convierte DECIMAL de MySQL (que llega como string) a number seguro.
const toNum = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : 0
}

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(',')

// Firma de un ejecutor de tool.
export type ToolExecutor = (user: HeroicaiUser, args: Record<string, unknown>) => Promise<unknown>

/**
 * Resuelve UNA sucursal a partir del NOMBRE (o id, por compatibilidad) que
 * eligió el modelo, y devuelve su id para uso interno. Si no se puede
 * determinar, lanza un Error con un mensaje amigable SIEMPRE por nombre
 * (nunca por id) para que el modelo repregunte o desambigüe. Si el usuario
 * tiene una sola sucursal, la usa sin preguntar.
 */
async function resolverSucursalRequerida(user: HeroicaiUser, args: Record<string, unknown>): Promise<number> {
  const accesibles = await getSucursalesDelUsuario(user)
  if (accesibles.length === 0) throw new Error('No tenés ninguna sucursal asignada.')

  // Id explícito válido (compatibilidad).
  const idArg = args.sucursal_id !== undefined ? Number(args.sucursal_id) : NaN
  if (Number.isFinite(idArg) && idArg > 0) {
    const m = accesibles.find(s => s.id === idArg)
    if (m) return m.id
  }

  // Nombre (coincidencia parcial, sin distinguir mayúsculas).
  const nombre = typeof args.sucursal === 'string' ? args.sucursal.trim() : ''
  if (nombre) {
    const q = nombre.toLowerCase()
    const matches = accesibles.filter(s => s.nombre.toLowerCase().includes(q))
    if (matches.length === 1) return matches[0].id
    if (matches.length > 1) {
      throw new Error(
        `Hay varias sucursales que coinciden con "${nombre}": ${matches.map(s => s.nombre).join(', ')}. ¿A cuál te referís?`,
      )
    }
    throw new Error(
      `No encontré ninguna sucursal llamada "${nombre}". Las disponibles son: ${accesibles.map(s => s.nombre).join(', ')}.`,
    )
  }

  // Sin dato pero una sola sucursal: usarla directamente.
  if (accesibles.length === 1) return accesibles[0].id

  // Varias y sin especificar: pedir por nombre.
  throw new Error(`¿De qué sucursal? Las disponibles son: ${accesibles.map(s => s.nombre).join(', ')}.`)
}

/**
 * Para tools que AGREGAN por defecto todas las sucursales del usuario: si el
 * modelo pasó un nombre/id lo limita a esa sucursal (validando acceso), y si
 * no, devuelve todas las accesibles.
 */
async function resolverSucursalesFiltro(user: HeroicaiUser, args: Record<string, unknown>): Promise<number[]> {
  const tieneFiltro =
    (typeof args.sucursal === 'string' && args.sucursal.trim() !== '') || args.sucursal_id !== undefined
  if (tieneFiltro) return [await resolverSucursalRequerida(user, args)]
  const accesibles = await getSucursalesDelUsuario(user)
  return accesibles.map(s => s.id)
}

// ─── Definiciones para OpenAI (function calling) ────────────────────────────

export const HEROICAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'listar_sucursales',
      description:
        'Lista los NOMBRES de las sucursales a las que el usuario tiene acceso. Usala solo cuando el usuario pide "qué sucursales hay" o necesitás saber cuáles existen. Para consultar datos de una sucursal NO hace falta esto: pasá el nombre directamente a la herramienta correspondiente.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_movimientos',
      description:
        'Resumen financiero (ingresos, egresos y saldo neto) de una sucursal en un rango de fechas. Para preguntas como "cuánto gasté/ingresé este mes". Requiere permiso ver_movimientos.',
      parameters: {
        type: 'object',
        properties: {
          sucursal: {
            type: 'string',
            description:
              'Nombre (o parte del nombre) de la sucursal, tal como lo dijo el usuario. Omitilo si el usuario tiene una sola sucursal.',
          },
          desde: { type: 'string', description: 'Fecha inicio inclusive, formato YYYY-MM-DD.' },
          hasta: { type: 'string', description: 'Fecha fin inclusive, formato YYYY-MM-DD.' },
          moneda: { type: 'string', enum: ['ARS', 'USD'], description: 'Moneda. Por defecto ARS.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_movimientos',
      description:
        'Lista movimientos de caja/banco de una sucursal, con filtros opcionales por tipo (ingreso/egreso) y texto en el concepto. Requiere permiso ver_movimientos.',
      parameters: {
        type: 'object',
        properties: {
          sucursal: {
            type: 'string',
            description: 'Nombre (o parte) de la sucursal. Omitilo si el usuario tiene una sola sucursal.',
          },
          tipo: { type: 'string', enum: ['ingreso', 'egreso'] },
          texto: { type: 'string', description: 'Texto a buscar en el concepto del movimiento.' },
          desde: { type: 'string', description: 'YYYY-MM-DD' },
          hasta: { type: 'string', description: 'YYYY-MM-DD' },
          moneda: { type: 'string', enum: ['ARS', 'USD'] },
          limit: { type: 'integer', description: 'Máximo de resultados (por defecto 20, tope 50).' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pagos_pendientes',
      description:
        'Lista pagos pendientes (solicitudes de pago) de las sucursales del usuario, con filtro opcional por sucursal y estado. Requiere permiso ver_pendientes.',
      parameters: {
        type: 'object',
        properties: {
          sucursal: {
            type: 'string',
            description: 'Opcional: nombre (o parte) de la sucursal para limitar el resultado.',
          },
          estado: { type: 'string', description: 'Opcional: estado del pago (ej. pendiente, aprobado, rechazado).' },
          limit: { type: 'integer' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'contar_personal',
      description:
        'Cuenta empleados de las sucursales del usuario, con filtros opcionales (solo activos, o solo en período de prueba). Para preguntas como "cuántos empleados hay" o "cuántos en período de prueba". Requiere permiso ver_personal.',
      parameters: {
        type: 'object',
        properties: {
          sucursal: {
            type: 'string',
            description: 'Opcional: nombre (o parte) de la sucursal para limitar el conteo.',
          },
          solo_activos: { type: 'boolean', description: 'Por defecto true.' },
          en_periodo_prueba: {
            type: 'boolean',
            description: 'Si es true, solo cuenta empleados en período de prueba.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_empleados',
      description:
        'Busca empleados por nombre, legajo o DNI en las sucursales del usuario. Requiere permiso ver_personal.',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'Nombre, legajo o DNI a buscar.' },
          sucursal: {
            type: 'string',
            description: 'Opcional: nombre (o parte) de la sucursal para acotar la búsqueda.',
          },
          limit: { type: 'integer' },
        },
        required: ['texto'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'solicitudes_rrhh',
      description:
        'Lista solicitudes de RRHH (vacaciones, licencias, apercibimientos, suspensiones, etc.) de las sucursales del usuario, con filtros opcionales por tipo y estado. Requiere permiso ver_solicitudes.',
      parameters: {
        type: 'object',
        properties: {
          sucursal: {
            type: 'string',
            description: 'Opcional: nombre (o parte) de la sucursal para limitar el resultado.',
          },
          tipo: { type: 'string', description: 'Tipo de solicitud (ej. Vacaciones, Licencias, Apercibimientos).' },
          estado: { type: 'string', enum: ['Pendiente', 'Aprobada', 'Rechazada', 'Cancelada'] },
          limit: { type: 'integer' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalas_salariales',
      description:
        'Escala salarial vigente (sueldo base y valor hora por puesto) de una sucursal. Es dato de referencia autoritativo; NO calcula el neto real de un empleado. Requiere permiso ver_sueldos.',
      parameters: {
        type: 'object',
        properties: {
          sucursal: {
            type: 'string',
            description: 'Nombre (o parte) de la sucursal. Omitilo si el usuario tiene una sola sucursal.',
          },
          puesto: { type: 'string', description: 'Opcional: filtra por nombre de puesto.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mis_tareas',
      description:
        'Lista las tareas del usuario (creadas por él o asignadas a él), con filtro opcional por estado. Para "qué tareas tengo pendientes".',
      parameters: {
        type: 'object',
        properties: {
          estado: { type: 'string', enum: ['pendiente', 'en_progreso', 'en_pruebas', 'completado', 'cancelado'] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_tareas',
      description: 'Busca tareas por texto en el título, con filtro opcional por estado.',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string' },
          estado: { type: 'string', enum: ['pendiente', 'en_progreso', 'en_pruebas', 'completado', 'cancelado'] },
          limit: { type: 'integer' },
        },
        required: ['texto'],
        additionalProperties: false,
      },
    },
  },
]

// ─── Ejecutores ─────────────────────────────────────────────────────────────

const clampLimit = (v: unknown, def = 20, max = 50): number => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return def
  return Math.min(Math.floor(n), max)
}

export const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  listar_sucursales: async user => {
    const sucursales = await getSucursalesDelUsuario(user)
    // Solo nombres: los ids son claves internas y no deben salir del backend.
    return { sucursales: sucursales.map(s => s.nombre) }
  },

  resumen_movimientos: async (user, args) => {
    await assertPermiso(user, 'ver_movimientos')
    const sucursalId = await resolverSucursalRequerida(user, args)
    const moneda = args.moneda === 'USD' ? 'USD' : 'ARS'

    const where = [
      'm.sucursal_id = ?',
      'm.moneda = ?',
      "m.saldo = 'saldo_real'",
      'm.deleted_at IS NULL',
      "NOT (m.estado = 'pendiente' AND m.categoria_id IS NULL)",
    ]
    const params: unknown[] = [sucursalId, moneda]
    if (typeof args.desde === 'string' && args.desde) {
      where.push('m.fecha >= ?')
      params.push(args.desde)
    }
    if (typeof args.hasta === 'string' && args.hasta) {
      where.push('m.fecha <= ?')
      params.push(args.hasta)
    }

    // Los egresos se almacenan con monto NEGATIVO en la DB. Para mostrar
    // magnitudes usamos ABS, y el saldo neto se calcula como SUM(monto)
    // (robusto ante el signo, sin importar la convención por fila).
    const rows = (await query(
      `SELECT
         COALESCE(SUM(CASE WHEN m.tipo = 'ingreso' THEN ABS(m.monto) ELSE 0 END), 0) AS ingresos,
         COALESCE(SUM(CASE WHEN m.tipo = 'egreso'  THEN ABS(m.monto) ELSE 0 END), 0) AS egresos,
         COALESCE(SUM(m.monto), 0) AS neto,
         COUNT(*) AS cantidad
       FROM movimientos m
       WHERE ${where.join(' AND ')}`,
      params,
    )) as Array<{ ingresos: unknown; egresos: unknown; neto: unknown; cantidad: number }>

    return {
      moneda,
      desde: args.desde ?? null,
      hasta: args.hasta ?? null,
      ingresos: toNum(rows[0]?.ingresos),
      egresos: toNum(rows[0]?.egresos),
      saldo_neto: toNum(rows[0]?.neto),
      cantidad_movimientos: Number(rows[0]?.cantidad ?? 0),
    }
  },

  buscar_movimientos: async (user, args) => {
    await assertPermiso(user, 'ver_movimientos')
    const sucursalId = await resolverSucursalRequerida(user, args)
    const limit = clampLimit(args.limit)

    const where = ["m.saldo = 'saldo_real'", 'm.sucursal_id = ?', 'm.deleted_at IS NULL']
    const params: unknown[] = [sucursalId]
    if (args.moneda === 'ARS' || args.moneda === 'USD') {
      where.push('m.moneda = ?')
      params.push(args.moneda)
    }
    if (args.tipo === 'ingreso' || args.tipo === 'egreso') {
      where.push('m.tipo = ?')
      params.push(args.tipo)
    }
    if (typeof args.texto === 'string' && args.texto.trim()) {
      where.push('m.concepto LIKE ?')
      params.push(`%${args.texto.trim()}%`)
    }
    if (typeof args.desde === 'string' && args.desde) {
      where.push('m.fecha >= ?')
      params.push(args.desde)
    }
    if (typeof args.hasta === 'string' && args.hasta) {
      where.push('m.fecha <= ?')
      params.push(args.hasta)
    }

    const rows = (await query(
      `SELECT m.id, m.fecha, m.concepto, m.monto, m.tipo, m.moneda, m.estado,
              m.tipo_movimiento, c.nombre AS categoria
       FROM movimientos m
       LEFT JOIN categorias c ON m.categoria_id = c.id
       WHERE ${where.join(' AND ')}
       ORDER BY m.fecha DESC, m.id DESC
       LIMIT ${limit}`,
      params,
    )) as Array<Record<string, unknown>>

    return {
      cantidad: rows.length,
      movimientos: rows.map(r => ({
        id: r.id,
        fecha: r.fecha,
        concepto: r.concepto,
        monto: Math.abs(toNum(r.monto)), // magnitud; el campo "tipo" indica ingreso/egreso
        tipo: r.tipo,
        moneda: r.moneda,
        estado: r.estado,
        origen: r.tipo_movimiento,
        categoria: r.categoria,
      })),
    }
  },

  pagos_pendientes: async (user, args) => {
    await assertPermiso(user, 'ver_pendientes')
    const sucursales = await resolverSucursalesFiltro(user, args)
    if (sucursales.length === 0) return { cantidad: 0, pagos: [] }
    const limit = clampLimit(args.limit)

    const where = [`pp.sucursal_id IN (${placeholders(sucursales.length)})`, 'pp.deleted_at IS NULL']
    const params: unknown[] = [...sucursales]
    if (typeof args.estado === 'string' && args.estado.trim()) {
      where.push('pp.estado = ?')
      params.push(args.estado.trim())
    }

    const rows = (await query(
      `SELECT s.nombre AS sucursal, pp.monto, pp.estado, pp.fecha,
              pp.concepto
       FROM pagos_pendientes pp
       LEFT JOIN sucursales s ON s.id = pp.sucursal_id
       WHERE ${where.join(' AND ')}
       ORDER BY pp.fecha DESC
       LIMIT ${limit}`,
      params,
    )) as Array<Record<string, unknown>>

    return {
      cantidad: rows.length,
      pagos: rows.map(r => ({ ...r, monto: toNum(r.monto) })),
    }
  },

  contar_personal: async (user, args) => {
    await assertPermiso(user, 'ver_personal')
    const sucursales = await resolverSucursalesFiltro(user, args)
    if (sucursales.length === 0) return { total: 0 }

    const soloActivos = args.solo_activos !== false
    const where = [`p.sucursal_id IN (${placeholders(sucursales.length)})`, 'p.deleted_at IS NULL']
    const params: unknown[] = [...sucursales]
    if (soloActivos) where.push('p.activo = 1')
    if (args.en_periodo_prueba === true) where.push('p.periodo_prueba = 1')

    const rows = (await query(
      `SELECT COUNT(*) AS total FROM personal p WHERE ${where.join(' AND ')}`,
      params,
    )) as Array<{ total: number }>

    return {
      total: Number(rows[0]?.total ?? 0),
      filtros: { solo_activos: soloActivos, en_periodo_prueba: args.en_periodo_prueba === true },
    }
  },

  buscar_empleados: async (user, args) => {
    await assertPermiso(user, 'ver_personal')
    const sucursales = await resolverSucursalesFiltro(user, args)
    if (sucursales.length === 0) return { cantidad: 0, empleados: [] }
    const limit = clampLimit(args.limit, 15, 30)
    const texto = String(args.texto ?? '').trim()

    const rows = (await query(
      `SELECT p.id, p.legajo, p.nombre, p.dni, pu.nombre AS puesto, p.sucursal_id,
              s.nombre AS sucursal, p.activo, p.periodo_prueba
       FROM personal p
       LEFT JOIN puestos pu ON pu.id = p.puesto_id
       LEFT JOIN sucursales s ON s.id = p.sucursal_id
       WHERE p.deleted_at IS NULL
         AND p.sucursal_id IN (${placeholders(sucursales.length)})
         AND (p.nombre LIKE ? OR p.legajo LIKE ? OR p.dni LIKE ?)
       ORDER BY p.nombre ASC
       LIMIT ${limit}`,
      [...sucursales, `%${texto}%`, `%${texto}%`, `%${texto}%`],
    )) as Array<Record<string, unknown>>

    return {
      cantidad: rows.length,
      empleados: rows.map(r => ({
        legajo: r.legajo,
        nombre: r.nombre,
        dni: r.dni,
        puesto: r.puesto,
        sucursal: r.sucursal,
        activo: Boolean(r.activo),
        en_periodo_prueba: Boolean(r.periodo_prueba),
      })),
    }
  },

  solicitudes_rrhh: async (user, args) => {
    await assertPermiso(user, 'ver_solicitudes')
    const sucursales = await resolverSucursalesFiltro(user, args)
    if (sucursales.length === 0) return { cantidad: 0, solicitudes: [] }
    const limit = clampLimit(args.limit)

    const where = [`sol.sucursal_id IN (${placeholders(sucursales.length)})`, 'sol.deleted_at IS NULL']
    const params: unknown[] = [...sucursales]
    if (typeof args.tipo === 'string' && args.tipo.trim()) {
      where.push('sol.tipo = ?')
      params.push(args.tipo.trim())
    }
    if (typeof args.estado === 'string' && args.estado.trim()) {
      where.push('sol.estado = ?')
      params.push(args.estado.trim())
    }

    const rows = (await query(
      `SELECT sol.tipo, sol.estado, sol.fecha_solicitud,
              s.nombre AS sucursal, per.nombre AS empleado
       FROM rrhh_solicitudes sol
       LEFT JOIN sucursales s ON s.id = sol.sucursal_id
       LEFT JOIN personal per ON per.id = sol.personal_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE WHEN sol.estado = 'Pendiente' THEN 0 ELSE 1 END, sol.fecha_solicitud DESC
       LIMIT ${limit}`,
      params,
    )) as Array<Record<string, unknown>>

    return { cantidad: rows.length, solicitudes: rows }
  },

  escalas_salariales: async (user, args) => {
    await assertPermiso(user, 'ver_sueldos')
    const sucursalId = await resolverSucursalRequerida(user, args)

    // Escala vigente = registro más reciente (anio, mes) por puesto en la sucursal.
    const params: unknown[] = [sucursalId]
    let puestoFilter = ''
    if (typeof args.puesto === 'string' && args.puesto.trim()) {
      puestoFilter = 'AND pu.nombre LIKE ?'
      params.push(`%${args.puesto.trim()}%`)
    }

    const rows = (await query(
      `SELECT pu.nombre AS puesto, es.sueldo_base, es.valor_hora, es.mes, es.anio
       FROM escalas_salariales es
       INNER JOIN puestos pu ON pu.id = es.puesto_id
       INNER JOIN (
         SELECT puesto_id, MAX(anio * 100 + mes) AS periodo
         FROM escalas_salariales
         WHERE sucursal_id = ? AND deleted_at IS NULL
         GROUP BY puesto_id
       ) ultima ON ultima.puesto_id = es.puesto_id
                AND (es.anio * 100 + es.mes) = ultima.periodo
       WHERE es.sucursal_id = ? AND es.deleted_at IS NULL ${puestoFilter}
       ORDER BY pu.nombre ASC`,
      [sucursalId, ...params],
    )) as Array<Record<string, unknown>>

    return {
      nota: 'Valores de referencia de la escala salarial vigente. No representan el neto liquidado real de cada empleado.',
      escalas: rows.map(r => ({
        puesto: r.puesto,
        sueldo_base: toNum(r.sueldo_base),
        valor_hora: r.valor_hora !== null ? toNum(r.valor_hora) : null,
        periodo: `${String(r.mes).padStart(2, '0')}/${r.anio}`,
      })),
    }
  },

  mis_tareas: async (user, args) => {
    const where = ['t.deleted_at IS NULL', '(t.asignado_a = ? OR t.creado_por = ?)']
    const params: unknown[] = [user.id, user.id]
    if (typeof args.estado === 'string' && args.estado.trim()) {
      where.push('t.estado = ?')
      params.push(args.estado.trim())
    }

    const rows = (await query(
      `SELECT t.id, t.codigo, t.titulo, t.tipo, t.prioridad, t.estado, t.created_at
       FROM tareas t
       WHERE ${where.join(' AND ')}
       ORDER BY FIELD(t.estado, 'pendiente','en_progreso','en_pruebas','completado','cancelado'),
                FIELD(t.prioridad, 'alta','media','baja'), t.created_at DESC
       LIMIT 30`,
      params,
    )) as Array<Record<string, unknown>>

    return { cantidad: rows.length, tareas: rows }
  },

  buscar_tareas: async (user, args) => {
    const limit = clampLimit(args.limit)
    const texto = String(args.texto ?? '').trim()
    const where = ['t.deleted_at IS NULL', 't.titulo LIKE ?']
    const params: unknown[] = [`%${texto}%`]
    if (typeof args.estado === 'string' && args.estado.trim()) {
      where.push('t.estado = ?')
      params.push(args.estado.trim())
    }

    const rows = (await query(
      `SELECT t.id, t.codigo, t.titulo, t.tipo, t.prioridad, t.estado, t.created_at,
              ua.nombre AS asignado_a
       FROM tareas t
       LEFT JOIN usuarios ua ON ua.id = t.asignado_a
       WHERE ${where.join(' AND ')}
       ORDER BY t.created_at DESC
       LIMIT ${limit}`,
      params,
    )) as Array<Record<string, unknown>>

    return { cantidad: rows.length, tareas: rows }
  },
}
