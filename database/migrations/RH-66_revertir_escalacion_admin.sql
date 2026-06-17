-- Migración RH-66: Revertir la escalación de permisos del rol 'admin'
-- Fecha: 2026-06-16
--
-- CONTEXTO: La versión inicial de RH-65 incluía un paso que le otorgaba al rol
-- 'admin' TODOS los permisos funcionales (Tesorería + RRHH). Eso fue un error:
-- el acceso por módulo NO debe otorgar capacidades. El módulo solo controla qué
-- áreas ve y a cuáles entra un usuario; lo que cada quien PUEDE HACER lo definen
-- los permisos de su rol (requirePermission).
--
-- Esta migración restaura el rol 'admin' EXACTAMENTE al conjunto de permisos que
-- tenía según las migraciones previas (011 + Puestos_refactor + CONSOLIDADO +
-- RH-20 / RH-33 / RH-59): base de Tesorería acotada + RRHH operativo, SIN
-- acciones elevadas (aprobar/eliminar movimientos, aprobar pendientes, gestionar
-- sucursales, reportes, sueldos, incentivos, aprobar solicitudes, etc.).
--
-- Sólo elimina; no agrega. Es idempotente. Si querés ampliar/acotar 'admin',
-- hacelo desde Configuración → Roles.

DELETE rp
FROM `roles_permisos` rp
JOIN `roles` r ON r.id = rp.rol_id
JOIN `permisos` p ON p.id = rp.permiso_id
WHERE r.nombre = 'admin'
  AND p.clave NOT IN (
    -- ── Tesorería / base (migración 011) ──
    'ver_pendientes',
    'cargar_pendientes',
    'ver_sucursales',
    -- ── RRHH — Áreas (Puestos_refactor / CONSOLIDADO) ──
    'ver_areas',
    'gestionar_areas',
    -- ── RRHH — Personal / Legajos (RH-59 / CONSOLIDADO) ──
    'ver_personal',
    'crear_personal',
    'gestionar_personal',
    'eliminar_personal',
    -- ── RRHH — Puestos (RH-59 / CONSOLIDADO) ──
    'ver_puestos',
    'gestionar_puestos',
    -- ── RRHH — Escalas (RH-59 / CONSOLIDADO) ──
    'ver_escalas',
    'gestionar_escalas',
    -- ── RRHH — Calendario (RH-59 / CONSOLIDADO) ──
    'ver_calendario',
    'gestionar_calendario',
    -- ── RRHH — Solicitudes (RH-20 / RH-33 / CONSOLIDADO) ──
    'ver_solicitudes',
    'crear_solicitudes',
    'editar_solicitudes',
    'cancelar_solicitudes'
  );
