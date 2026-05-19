-- Migración RH-20: asignación de permisos para solicitudes RRHH por rol
-- Fecha: 2026-04-29

INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN ('ver_solicitudes', 'crear_solicitudes')
WHERE r.nombre = 'admin';

INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN ('ver_solicitudes', 'crear_solicitudes')
WHERE r.nombre = 'gerente';

DELETE rp
FROM `roles_permisos` rp
INNER JOIN `roles` r ON r.id = rp.rol_id
INNER JOIN `permisos` p ON p.id = rp.permiso_id
WHERE r.nombre IN ('admin', 'gerente')
  AND p.clave = 'gestionar_solicitudes';
