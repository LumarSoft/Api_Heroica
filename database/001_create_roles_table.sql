-- Migración: Creación de tabla de roles y migración de usuarios
-- Fecha: 2026-03-11
-- Descripción: Tabla para gestionar roles de usuarios del sistema y migración de la columna rol

-- Paso 1: Crear tabla de roles
CREATE TABLE `roles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nombre` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Paso 2: Insertar roles iniciales
INSERT INTO `roles` (`nombre`) VALUES 
('gerente'),
('admin'),
('superadmin');

-- Paso 3: Agregar nueva columna rol_id a la tabla usuarios
ALTER TABLE `usuarios` ADD COLUMN `rol_id` int DEFAULT NULL AFTER `nombre`;

-- Paso 4: Migrar datos existentes de usuarios a los nuevos roles
-- admin@heroica.com -> superadmin (id: 3)
UPDATE `usuarios` SET `rol_id` = 3 WHERE `email` = 'admin@heroica.com';

-- contador@heroica.com -> admin (id: 2)
UPDATE `usuarios` SET `rol_id` = 2 WHERE `email` = 'contador@heroica.com';

-- empleados -> gerente (id: 1)
UPDATE `usuarios` SET `rol_id` = 1 WHERE `email` IN ('empleado@heroica.com', 'empleado2@heroica.com');

-- Paso 5: Agregar foreign key constraint
ALTER TABLE `usuarios` 
ADD CONSTRAINT `usuarios_ibfk_rol` 
FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT;

-- Paso 6: Eliminar la columna rol antigua (enum)
ALTER TABLE `usuarios` DROP COLUMN `rol`;
