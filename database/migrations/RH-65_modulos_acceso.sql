-- Migración RH-65: Acceso por módulo (capa independiente del rol)
-- Fecha: 2026-06-16
-- Descripción:
--   Introduce una capa de "módulos" (Tesorería, Recursos Humanos) que se asigna
--   por USUARIO, independientemente del rol. El rol sigue definiendo QUÉ puede
--   hacer (permisos); el módulo define DÓNDE (a qué área del sistema entra).
--   Así una responsable de RRHH puede ser rol 'admin' con acceso solo al módulo
--   de RRHH, sin necesidad de ser superadmin ni ver Tesorería.
--
--   El superadmin sigue teniendo bypass total (ve todos los módulos).

-- ============================================================
-- Paso 1: Catálogo de módulos
-- ============================================================

CREATE TABLE IF NOT EXISTS `modulos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `clave` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `clave` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `modulos` (`clave`, `nombre`, `descripcion`) VALUES
  ('tesoreria',        'Tesorería',        'Sucursales, movimientos de caja, pagos pendientes y reportes'),
  ('recursos_humanos', 'Recursos Humanos', 'Personal, legajos, escalas, sueldos, solicitudes y calendario')
ON DUPLICATE KEY UPDATE
  `nombre` = VALUES(`nombre`),
  `descripcion` = VALUES(`descripcion`);

-- ============================================================
-- Paso 2: Tabla intermedia usuarios_modulos (acceso por usuario)
-- ============================================================

CREATE TABLE IF NOT EXISTS `usuarios_modulos` (
  `usuario_id` int NOT NULL,
  `modulo_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`usuario_id`, `modulo_id`),
  CONSTRAINT `um_usuario_fk` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `um_modulo_fk` FOREIGN KEY (`modulo_id`) REFERENCES `modulos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Paso 3: Backfill de accesos (IMPORTANTE: correr ANTES del Paso 4)
--   Otorga a cada usuario los módulos a los que YA tenía acceso según
--   los permisos de su rol actual. Así nadie pierde acceso al activar
--   el gateo por módulo.
-- ============================================================

-- Tesorería: usuarios cuyo rol tiene algún permiso de tesorería.
INSERT IGNORE INTO `usuarios_modulos` (`usuario_id`, `modulo_id`)
SELECT u.id, m.id
FROM `usuarios` u
JOIN `roles_permisos` rp ON rp.rol_id = u.rol_id
JOIN `permisos` p ON p.id = rp.permiso_id
JOIN `modulos` m ON m.clave = 'tesoreria'
WHERE p.categoria IN ('Movimientos', 'Pendientes', 'Sucursales', 'Reportes')
GROUP BY u.id, m.id;

-- Recursos Humanos: usuarios cuyo rol tiene algún permiso de RRHH.
INSERT IGNORE INTO `usuarios_modulos` (`usuario_id`, `modulo_id`)
SELECT u.id, m.id
FROM `usuarios` u
JOIN `roles_permisos` rp ON rp.rol_id = u.rol_id
JOIN `permisos` p ON p.id = rp.permiso_id
JOIN `modulos` m ON m.clave = 'recursos_humanos'
WHERE p.categoria = 'Recursos Humanos'
GROUP BY u.id, m.id;

-- ============================================================
-- Paso 4: El rol 'admin' pasa a tener TODOS los permisos funcionales
--   (Tesorería + RRHH), EXCLUYENDO los permisos sensibles de Configuración
--   (gestión de usuarios/roles). De este modo 'admin' es un operador completo,
--   y lo que limita a cada admin es el acceso por módulo (Paso 2/3), no el rol.
--
--   Es aditivo (INSERT IGNORE) y reversible desde Configuración → Roles.
-- ============================================================

INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.categoria <> 'Configuración'
WHERE r.nombre = 'admin';
