import { query } from './database'

/**
 * ============================================================
 *  DEFINICIÓN CENTRALIZADA DE PERMISOS DEL SISTEMA
 * ============================================================
 *
 * Al agregar un nuevo módulo al sistema:
 *   1. Definí los permisos del módulo en PERMISOS_DEL_SISTEMA (abajo).
 *   2. Usá la clave como argumento de requirePermission() en las rutas.
 *   3. Agregá el helper semántico correspondiente en authStore.ts (frontend).
 *   4. Actualizá PERMISOS en lib/constants.ts (frontend).
 *
 * El sistema los sincronizará automáticamente con la BD al reiniciar la API.
 * NO es necesario correr migraciones manuales para agregar permisos.
 * ============================================================
 */

interface PermisoDefinicion {
  clave: string
  descripcion: string
  categoria: string
}

export const PERMISOS_DEL_SISTEMA: PermisoDefinicion[] = [
  // ── MÓDULO: MOVIMIENTOS DE CAJA ──────────────────────────────────────────
  {
    clave: 'ver_movimientos',
    descripcion: 'Ver movimientos de caja (efectivo y banco)',
    categoria: 'Movimientos',
  },
  {
    clave: 'crear_movimientos',
    descripcion: 'Crear nuevos movimientos de caja',
    categoria: 'Movimientos',
  },
  {
    clave: 'editar_movimientos',
    descripcion: 'Editar movimientos de caja existentes',
    categoria: 'Movimientos',
  },
  {
    clave: 'eliminar_movimientos',
    descripcion: 'Eliminar movimientos de caja',
    categoria: 'Movimientos',
  },
  {
    clave: 'aprobar_movimientos',
    descripcion: 'Aprobar o rechazar movimientos (cambiar estado)',
    categoria: 'Movimientos',
  },

  // ── MÓDULO: PAGOS PENDIENTES ─────────────────────────────────────────────
  {
    clave: 'ver_pendientes',
    descripcion: 'Ver listado de pagos pendientes',
    categoria: 'Pendientes',
  },
  {
    clave: 'cargar_pendientes',
    descripcion: 'Cargar nuevas solicitudes de pago pendiente',
    categoria: 'Pendientes',
  },
  {
    clave: 'aprobar_pendientes',
    descripcion: 'Aprobar o rechazar pagos pendientes',
    categoria: 'Pendientes',
  },

  // ── MÓDULO: SUCURSALES ───────────────────────────────────────────────────
  {
    clave: 'ver_sucursales',
    descripcion: 'Ver el listado de sucursales',
    categoria: 'Sucursales',
  },
  {
    clave: 'gestionar_sucursales',
    descripcion: 'Crear, editar y desactivar sucursales',
    categoria: 'Sucursales',
  },

  // ── MÓDULO: REPORTES ─────────────────────────────────────────────────────
  {
    clave: 'ver_reportes',
    descripcion: 'Acceder al módulo de reportes y analítica',
    categoria: 'Reportes',
  },

  // ── MÓDULO: CONFIGURACIÓN ────────────────────────────────────────────────
  {
    clave: 'ver_configuracion',
    descripcion: 'Acceder al panel de configuración general',
    categoria: 'Configuración',
  },
  {
    clave: 'gestionar_usuarios',
    descripcion: 'Crear, editar y desactivar usuarios',
    categoria: 'Configuración',
  },
  {
    clave: 'gestionar_roles',
    descripcion: 'Crear, editar y eliminar roles y sus permisos',
    categoria: 'Configuración',
  },

  // ── MÓDULO: RRHH - LEGAJOS / PERSONAL ───────────────────────────────────
  {
    clave: 'ver_personal',
    descripcion: 'Ver el listado de colaboradores y sus legajos',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'crear_personal',
    descripcion: 'Agregar nuevos colaboradores al sistema',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'gestionar_personal',
    descripcion: 'Editar datos personales y profesionales de colaboradores',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'eliminar_personal',
    descripcion: 'Eliminar colaboradores del sistema',
    categoria: 'Recursos Humanos',
  },

  // ── MÓDULO: RRHH - PUESTOS ──────────────────────────────────────────────
  {
    clave: 'ver_puestos',
    descripcion: 'Ver puestos de trabajo disponibles',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'gestionar_puestos',
    descripcion: 'Crear, editar y eliminar puestos de trabajo',
    categoria: 'Recursos Humanos',
  },

  // ── MÓDULO: RRHH - ESCALAS SALARIALES ───────────────────────────────────
  {
    clave: 'ver_escalas',
    descripcion: 'Ver escalas salariales',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'gestionar_escalas',
    descripcion: 'Crear, editar y eliminar escalas salariales',
    categoria: 'Recursos Humanos',
  },

  // ── MÓDULO: RRHH - INCENTIVOS Y PREMIOS ─────────────────────────────────
  {
    clave: 'ver_incentivos',
    descripcion: 'Ver incentivos y premios de RRHH',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'gestionar_incentivos',
    descripcion: 'Crear, editar y desactivar incentivos y premios de RRHH',
    categoria: 'Recursos Humanos',
  },

  // ── MÓDULO: RRHH - CALENDARIO ────────────────────────────────────────────
  {
    clave: 'ver_calendario',
    descripcion: 'Ver el calendario de eventos de RRHH',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'gestionar_calendario',
    descripcion: 'Crear, editar y eliminar eventos del calendario de RRHH',
    categoria: 'Recursos Humanos',
  },

  // ── MÓDULO: RRHH - SOLICITUDES ──────────────────────────────────────────
  {
    clave: 'ver_solicitudes',
    descripcion: 'Ver solicitudes de Recursos Humanos',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'crear_solicitudes',
    descripcion: 'Crear solicitudes de Recursos Humanos',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'editar_solicitudes',
    descripcion: 'Editar solicitudes pendientes de Recursos Humanos',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'cancelar_solicitudes',
    descripcion: 'Cancelar solicitudes pendientes de Recursos Humanos',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'aprobar_solicitudes',
    descripcion: 'Aprobar o rechazar solicitudes de Recursos Humanos',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'ver_historial_solicitudes_global',
    descripcion: 'Ver historial global de solicitudes de todas las sucursales',
    categoria: 'Recursos Humanos',
  },
  {
    clave: 'ver_solicitudes_todas_sucursales',
    descripcion: 'Ver solicitudes de Recursos Humanos de todas las sucursales',
    categoria: 'Recursos Humanos',
  },

  // ── [TEMPLATE] NUEVO MÓDULO ──────────────────────────────────────────────
  // Al agregar un nuevo módulo, copiá el bloque de abajo y completalo:
  //
  // {
  //   clave: "ver_[modulo]",
  //   descripcion: "Ver el módulo de [nombre]",
  //   categoria: "[Nombre del Módulo]",
  // },
  // {
  //   clave: "gestionar_[modulo]",
  //   descripcion: "Gestionar registros del módulo de [nombre]",
  //   categoria: "[Nombre del Módulo]",
  // },
]

/**
 * Sincroniza los permisos definidos en PERMISOS_DEL_SISTEMA con la base de datos.
 * - Inserta los permisos que no existen aún (por clave única).
 * - Actualiza descripción y categoría de los ya existentes.
 * - NO elimina permisos que ya no estén en la lista (por seguridad).
 *
 * Se llama automáticamente al iniciar la API.
 */
export async function syncPermisos(): Promise<void> {
  if (PERMISOS_DEL_SISTEMA.length === 0) return

  try {
    // Upsert: INSERT … ON DUPLICATE KEY UPDATE
    // La tabla permisos debe tener UNIQUE KEY en (clave).
    const values = PERMISOS_DEL_SISTEMA.map(() => '(?, ?, ?)').join(', ')
    const params = PERMISOS_DEL_SISTEMA.flatMap(p => [p.clave, p.descripcion, p.categoria])

    await query(
      `INSERT INTO permisos (clave, descripcion, categoria)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE
         descripcion = VALUES(descripcion),
         categoria   = VALUES(categoria)`,
      params,
    )

    console.log(`  ✅ Permisos sincronizados: ${PERMISOS_DEL_SISTEMA.length} definiciones procesadas.`)
  } catch (error) {
    console.error('  ❌ Error al sincronizar permisos:', error)
    // No bloqueamos el arranque del servidor; solo logueamos.
  }
}
