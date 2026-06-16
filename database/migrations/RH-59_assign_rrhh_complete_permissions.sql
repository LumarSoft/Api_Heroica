-- Migración RH-59: permisos completos para todos los sub-módulos de RRHH
-- Fecha: 2026-04-30
--
-- Cubre los nuevos permisos de:
--   • Personal/Legajos  (ver, crear, gestionar, eliminar)
--   • Puestos           (ver, gestionar)
--   • Escalas salariales(ver, gestionar)
--   • Calendario RRHH   (ver, gestionar)
--
-- Política por rol:
--   superadmin  → bypass total (no necesita filas en roles_permisos)
--   admin       → acceso completo a todos los sub-módulos RRHH
--   gerente     → ver y operar personal, puestos, escalas y calendario; NO eliminar personal
--   directivo   → solo lectura (ver) en personal, puestos, escalas y calendario

-- ── ADMIN: acceso completo RRHH ───────────────────────────────────────────
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN (
  'ver_personal',
  'crear_personal',
  'gestionar_personal',
  'eliminar_personal',
  'ver_puestos',
  'gestionar_puestos',
  'ver_escalas',
  'gestionar_escalas',
  'ver_calendario',
  'gestionar_calendario'
)
WHERE r.nombre = 'admin';

-- ── GERENTE: operación RRHH sin eliminar personal ─────────────────────────
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN (
  'ver_personal',
  'crear_personal',
  'gestionar_personal',
  'ver_puestos',
  'gestionar_puestos',
  'ver_escalas',
  'gestionar_escalas',
  'ver_calendario',
  'gestionar_calendario'
)
WHERE r.nombre = 'gerente';

-- ── DIRECTIVO: solo lectura RRHH ──────────────────────────────────────────
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN (
  'ver_personal',
  'ver_puestos',
  'ver_escalas',
  'ver_calendario'
)
WHERE r.nombre = 'directivo';
