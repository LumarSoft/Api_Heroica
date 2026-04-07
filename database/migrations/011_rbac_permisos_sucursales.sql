-- Migración 006: RBAC - Permisos por Rol + Sucursales por Usuario
-- Fecha: 2026-03-30
-- Descripción: Sistema de permisos granulares y asignación de sucursales por usuario

-- ============================================================
-- Paso 1: Agregar descripción a roles y must_change_password a usuarios
-- ============================================================

ALTER TABLE `roles` 
  ADD COLUMN `descripcion` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `nombre`,
  ADD COLUMN `es_sistema` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Si es 1, no se puede eliminar' AFTER `descripcion`;

ALTER TABLE `usuarios`
  ADD COLUMN `must_change_password` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Fuerza cambio de contraseña en el próximo login' AFTER `activo`;

-- ============================================================
-- Paso 2: Actualizar roles existentes con descripción y marcar como sistema
-- ============================================================

UPDATE `roles` SET `descripcion` = 'Acceso total al sistema', `es_sistema` = 1 WHERE `nombre` = 'superadmin';
UPDATE `roles` SET `descripcion` = 'Acceso solo a pagos pendientes', `es_sistema` = 1 WHERE `nombre` = 'admin';
UPDATE `roles` SET `descripcion` = 'Solo lectura + comentarios', `es_sistema` = 0 WHERE `nombre` = 'gerente';

-- ============================================================
-- Paso 3: Insertar rol Directivo
-- ============================================================

INSERT INTO `roles` (`nombre`, `descripcion`, `es_sistema`) VALUES 
('directivo', 'Todo en lectura + opción de comentarios, sin modificaciones', 1);

-- ============================================================
-- Paso 4: Crear tabla de permisos (catálogo)
-- ============================================================

CREATE TABLE `permisos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `clave` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `categoria` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Agrupación visual',
  PRIMARY KEY (`id`),
  UNIQUE KEY `clave` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Paso 5: Insertar catálogo de permisos
-- ============================================================

INSERT INTO `permisos` (`clave`, `descripcion`, `categoria`) VALUES
-- Movimientos
('ver_movimientos',       'Ver movimientos de sucursales asignadas',  'Movimientos'),
('crear_movimientos',     'Crear nuevos movimientos',                  'Movimientos'),
('editar_movimientos',    'Editar movimientos existentes',             'Movimientos'),
('eliminar_movimientos',  'Eliminar movimientos',                      'Movimientos'),
('aprobar_movimientos',   'Aprobar o rechazar movimientos',            'Movimientos'),
('agregar_comentarios',   'Agregar comentarios a movimientos',         'Movimientos'),
-- Pendientes
('ver_pendientes',        'Ver pagos pendientes',                      'Pendientes'),
('cargar_pendientes',     'Cargar nuevos pagos pendientes',            'Pendientes'),
('aprobar_pendientes',    'Aprobar o rechazar pagos pendientes',       'Pendientes'),
-- Sucursales
('ver_sucursales',        'Ver listado de sucursales',                 'Sucursales'),
('gestionar_sucursales',  'Crear, editar y eliminar sucursales',       'Sucursales'),
-- Reportes
('ver_reportes',          'Acceder a reportes financieros',            'Reportes'),
-- Usuarios y configuración
('gestionar_usuarios',    'Crear, editar y eliminar usuarios',         'Configuración'),
('gestionar_roles',       'Crear y editar roles y sus permisos',       'Configuración'),
('ver_configuracion',     'Acceder a la sección de configuración',     'Configuración');

-- ============================================================
-- Paso 6: Crear tabla intermedia roles_permisos
-- ============================================================

CREATE TABLE `roles_permisos` (
  `rol_id` int NOT NULL,
  `permiso_id` int NOT NULL,
  PRIMARY KEY (`rol_id`, `permiso_id`),
  CONSTRAINT `rp_rol_fk` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `rp_permiso_fk` FOREIGN KEY (`permiso_id`) REFERENCES `permisos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Paso 7: Asignar permisos iniciales por rol
-- ============================================================

-- Superadmin: todos los permisos
INSERT INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id FROM `roles` r, `permisos` p WHERE r.nombre = 'superadmin';

-- Admin: solo pendientes
INSERT INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id FROM `roles` r
JOIN `permisos` p ON p.clave IN ('ver_pendientes', 'cargar_pendientes', 'ver_sucursales')
WHERE r.nombre = 'admin';

-- Directivo: todo en lectura + comentarios
INSERT INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id FROM `roles` r
JOIN `permisos` p ON p.clave IN (
  'ver_movimientos', 'agregar_comentarios',
  'ver_pendientes',
  'ver_sucursales',
  'ver_reportes',
  'ver_configuracion'
)
WHERE r.nombre = 'directivo';

-- Gerente: mismo perfil que admin por ahora
INSERT INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id FROM `roles` r
JOIN `permisos` p ON p.clave IN ('ver_pendientes', 'cargar_pendientes', 'ver_sucursales')
WHERE r.nombre = 'gerente';

-- ============================================================
-- Paso 8: Crear tabla usuarios_sucursales
-- ============================================================

CREATE TABLE `usuarios_sucursales` (
  `usuario_id` int NOT NULL,
  `sucursal_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`usuario_id`, `sucursal_id`),
  CONSTRAINT `us_usuario_fk` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `us_sucursal_fk` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
