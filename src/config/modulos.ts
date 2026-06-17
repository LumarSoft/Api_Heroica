import { query } from './database'

/**
 * ============================================================
 *  DEFINICIÓN CENTRALIZADA DE MÓDULOS DEL SISTEMA
 * ============================================================
 *
 * Un "módulo" es una capa de acceso de alto nivel (Tesorería, RRHH) que se
 * asigna POR USUARIO, independientemente del rol. El rol define QUÉ puede
 * hacer (permisos); el módulo define DÓNDE (a qué área entra).
 *
 * El superadmin tiene bypass total (ve todos los módulos).
 *
 * Al agregar un módulo nuevo:
 *   1. Agregalo a MODULOS_DEL_SISTEMA (abajo).
 *   2. Gateá sus rutas con requireModule('<clave>').
 *   3. Agregá la clave en lib/constants.ts y el guard en el frontend.
 *
 * Se sincroniza con la BD al iniciar la API (no requiere migración manual).
 * ============================================================
 */

interface ModuloDefinicion {
  clave: string
  nombre: string
  descripcion: string
}

export const MODULOS_DEL_SISTEMA: ModuloDefinicion[] = [
  {
    clave: 'tesoreria',
    nombre: 'Tesorería',
    descripcion: 'Sucursales, movimientos de caja, pagos pendientes y reportes',
  },
  {
    clave: 'recursos_humanos',
    nombre: 'Recursos Humanos',
    descripcion: 'Personal, legajos, escalas, sueldos, solicitudes y calendario',
  },
]

/**
 * Sincroniza los módulos definidos arriba con la base de datos (upsert por clave).
 * No elimina módulos que ya no estén en la lista (por seguridad).
 * Se llama automáticamente al iniciar la API.
 */
export async function syncModulos(): Promise<void> {
  if (MODULOS_DEL_SISTEMA.length === 0) return

  try {
    const values = MODULOS_DEL_SISTEMA.map(() => '(?, ?, ?)').join(', ')
    const params = MODULOS_DEL_SISTEMA.flatMap(m => [m.clave, m.nombre, m.descripcion])

    await query(
      `INSERT INTO modulos (clave, nombre, descripcion)
       VALUES ${values}
       ON DUPLICATE KEY UPDATE
         nombre = VALUES(nombre),
         descripcion = VALUES(descripcion)`,
      params,
    )

    console.log(`  ✅ Módulos sincronizados: ${MODULOS_DEL_SISTEMA.length} definiciones procesadas.`)
  } catch (error) {
    console.error('  ❌ Error al sincronizar módulos:', error)
    // No bloqueamos el arranque del servidor; solo logueamos.
  }
}
