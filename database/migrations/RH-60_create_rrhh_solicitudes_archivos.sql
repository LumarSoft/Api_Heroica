-- Migración RH-60: Tabla de archivos adjuntos de solicitudes RRHH
-- Extrae los archivos del campo JSON detalles a una tabla normalizada,
-- permitiendo listar y gestionar adjuntos sin parsear JSON.
-- Fecha: 2026-05-19

CREATE TABLE `rrhh_solicitudes_archivos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `solicitud_id` int NOT NULL,
  `tipo_doc` varchar(80) NOT NULL,
  `url` text NOT NULL,
  `nombre_original` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_solicitudes_archivos_solicitud` (`solicitud_id`),
  CONSTRAINT `fk_solicitudes_archivos_solicitud` FOREIGN KEY (`solicitud_id`) REFERENCES `rrhh_solicitudes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
