-- Migración RH-56: Crear tabla de solicitudes (RRHH)
-- Fecha: 2026-04-28

CREATE TABLE `rrhh_solicitudes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sucursal_id` int NOT NULL,
  `personal_id` int DEFAULT NULL, -- Nullable para Altas o solicitudes generales
  `usuario_id` int NOT NULL, -- Usuario que crea la solicitud
  `tipo` enum('Altas', 'Bajas', 'Novedades de sueldo', 'Incentivos y premios', 'Licencias', 'Vacaciones', 'Suspensiones', 'Apercibimientos', 'Capacitaciones', 'Pedido de uniforme', 'Adelantos') NOT NULL,
  `estado` enum('Pendiente', 'Aprobada', 'Rechazada', 'Cancelada') NOT NULL DEFAULT 'Pendiente',
  `fecha_solicitud` date NOT NULL,
  `detalles` json DEFAULT NULL, -- Campos específicos según el tipo de solicitud
  `observaciones` text DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `rrhh_solicitudes_sucursal_fk` (`sucursal_id`),
  KEY `rrhh_solicitudes_personal_fk` (`personal_id`),
  KEY `rrhh_solicitudes_usuario_fk` (`usuario_id`),
  CONSTRAINT `rrhh_solicitudes_sucursal_fk` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `rrhh_solicitudes_personal_fk` FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `rrhh_solicitudes_usuario_fk` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
