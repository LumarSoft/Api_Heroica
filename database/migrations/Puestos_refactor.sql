-- Migración RH-60: Áreas globales + puestos desacoplados de sucursal
-- Fecha: 2026-05-04
--
-- Cambios:
--   • Crea tabla `areas` (entidades globales, independientes de sucursal)
--   • Modifica `puestos`: quita sucursal_id y area (varchar), agrega area_id FK → areas
--   • Inserta permisos ver_areas / gestionar_areas
--   • Asigna permisos a roles (admin, gerente, directivo)
--
-- IMPORTANTE: si existen puestos en la tabla, se les asigna un área "General"
-- creada automáticamente. Luego reasignar manualmente si corresponde.

-- ── 1. Crear tabla areas ──────────────────────────────────────────────────────

CREATE TABLE `areas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `descripcion` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `areas_nombre_unique` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Insertar área por defecto para datos existentes ────────────────────────

INSERT INTO `areas` (`nombre`, `descripcion`)
SELECT 'General', 'Área creada automáticamente para puestos pre-existentes'
WHERE EXISTS (SELECT 1 FROM `puestos` WHERE `deleted_at` IS NULL LIMIT 1);

-- ── 3. Agregar area_id a puestos (nullable temporalmente) ─────────────────────

ALTER TABLE `puestos`
  ADD COLUMN `area_id` int DEFAULT NULL AFTER `nombre`;

-- ── 4. Asignar área General a todos los puestos existentes ────────────────────

UPDATE `puestos` p
JOIN `areas` a ON a.nombre = 'General'
SET p.area_id = a.id
WHERE p.area_id IS NULL;

-- ── 5. Agregar FK y hacer area_id NOT NULL ────────────────────────────────────

ALTER TABLE `puestos`
  MODIFY COLUMN `area_id` int NOT NULL,
  ADD CONSTRAINT `puestos_area_fk` FOREIGN KEY (`area_id`) REFERENCES `areas` (`id`) ON DELETE RESTRICT;

-- ── 6. Quitar sucursal_id y area varchar de puestos ───────────────────────────

ALTER TABLE `puestos`
  DROP FOREIGN KEY `puestos_sucursal_fk`,
  DROP INDEX `puestos_sucursal_fk`,
  DROP COLUMN `sucursal_id`,
  DROP COLUMN `area`;

-- ── 7. Insertar permisos de áreas ─────────────────────────────────────────────

INSERT IGNORE INTO `permisos` (`clave`, `descripcion`, `categoria`) VALUES
  ('ver_areas',      'Ver áreas de la organización',              'Recursos Humanos'),
  ('gestionar_areas','Crear, editar y eliminar áreas',            'Recursos Humanos');

-- ── 8. Asignar permisos a roles ───────────────────────────────────────────────

-- admin: acceso completo a áreas
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN ('ver_areas', 'gestionar_areas')
WHERE r.nombre = 'admin';

-- gerente: acceso completo a áreas
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN ('ver_areas', 'gestionar_areas')
WHERE r.nombre = 'gerente';

-- directivo: solo lectura áreas
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permisos` p ON p.clave IN ('ver_areas')
WHERE r.nombre = 'directivo';
