-- Migración RH-61: Tabla de empleados en novedades de sueldo y liquidaciones de baja
-- Extrae el array empleados[] del JSON detalles a filas relacionales,
-- habilitando consultas cruzadas por período, área y colaborador.
-- Fecha: 2026-05-19

CREATE TABLE `rrhh_solicitudes_novedades_empleados` (
  `id` int NOT NULL AUTO_INCREMENT,
  `solicitud_id` int NOT NULL,
  `personal_id` int NOT NULL,
  `personal_nombre` varchar(255) NOT NULL,
  `tipo_origen` enum('novedad_sueldo','liquidacion_baja') NOT NULL DEFAULT 'novedad_sueldo',
  -- Cambio de puesto
  `cambio_puesto` tinyint(1) NOT NULL DEFAULT '0',
  `nuevo_puesto_id` int DEFAULT NULL,
  `fecha_alta_puesto` date DEFAULT NULL,
  -- Horas
  `horas_trabajadas` decimal(7,2) DEFAULT NULL,
  `horas_feriados` decimal(7,2) DEFAULT NULL,
  `horas_extras_autorizadas` tinyint(1) NOT NULL DEFAULT '0',
  `horas_extras_cantidad` decimal(7,2) DEFAULT NULL,
  -- Apercibimiento
  `apercibimiento` tinyint(1) NOT NULL DEFAULT '0',
  `apercibimiento_motivo` text DEFAULT NULL,
  `apercibimiento_archivo_url` text DEFAULT NULL,
  `apercibimiento_archivo_nombre` varchar(255) DEFAULT NULL,
  -- Suspensión
  `suspension` tinyint(1) NOT NULL DEFAULT '0',
  `suspension_motivo` text DEFAULT NULL,
  `suspension_archivo_url` text DEFAULT NULL,
  `suspension_archivo_nombre` varchar(255) DEFAULT NULL,
  -- Descuento
  `descuento` tinyint(1) NOT NULL DEFAULT '0',
  `descuento_monto` decimal(12,2) DEFAULT NULL,
  `descuento_motivo` text DEFAULT NULL,
  -- Ausencias justificadas
  `aus_just` tinyint(1) NOT NULL DEFAULT '0',
  `aus_just_cantidad` decimal(7,2) DEFAULT NULL,
  `aus_just_unidad` enum('horas','minutos') NOT NULL DEFAULT 'horas',
  `aus_just_motivo` text DEFAULT NULL,
  -- Ausencias injustificadas
  `aus_injust_cantidad` decimal(7,2) DEFAULT NULL,
  `aus_injust_unidad` enum('horas','minutos') NOT NULL DEFAULT 'horas',
  `aus_injust_motivo` text DEFAULT NULL,
  -- Tardanzas
  `tardanzas` tinyint(1) NOT NULL DEFAULT '0',
  `tardanzas_cantidad` decimal(7,2) DEFAULT NULL,
  `tardanzas_unidad` enum('horas','minutos') NOT NULL DEFAULT 'horas',
  `tardanzas_motivo` text DEFAULT NULL,
  -- Incentivos (array reducido, mantiene JSON)
  `incentivos` json DEFAULT NULL,
  `observaciones` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nov_emp_solicitud` (`solicitud_id`),
  KEY `idx_nov_emp_personal` (`personal_id`),
  CONSTRAINT `fk_nov_emp_solicitud` FOREIGN KEY (`solicitud_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_nov_emp_personal` FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
