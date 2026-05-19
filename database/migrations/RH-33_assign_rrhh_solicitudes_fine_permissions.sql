-- Migración RH-33: permisos finos para solicitudes RRHH
-- Fecha: 2026-04-29

INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN (
  'ver_solicitudes',
  'crear_solicitudes',
  'editar_solicitudes',
  'cancelar_solicitudes'
)
WHERE r.nombre IN ('admin', 'gerente');

INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN (
  'ver_solicitudes',
  'ver_historial_solicitudes_global'
)
WHERE r.nombre = 'directivo';
