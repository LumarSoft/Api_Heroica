-- RH-61: Catálogo de motivos de baja (RRHH solicitudes Bajas)

CREATE TABLE `rrhh_motivos_baja` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sucursal_id` int NOT NULL,
  `nombre` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `orden` smallint NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `rrhh_motivos_baja_sucursal_fk` (`sucursal_id`),
  CONSTRAINT `rrhh_motivos_baja_sucursal_fk` FOREIGN KEY (`sucursal_id`) REFERENCES `sucursales` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `rrhh_motivos_baja` (`sucursal_id`, `nombre`, `orden`)
SELECT s.id, m.nombre, m.orden
FROM `sucursales` s
CROSS JOIN (
  SELECT 'Desvinculación' AS nombre, 10 AS orden
  UNION ALL SELECT 'Renuncia voluntaria', 20
  UNION ALL SELECT 'Despido sin causa', 30
  UNION ALL SELECT 'Despido con causa', 40
  UNION ALL SELECT 'Fin período de prueba', 50
  UNION ALL SELECT 'Fin contrato temporal', 60
  UNION ALL SELECT 'Jubilación', 70
  UNION ALL SELECT 'Mutuo acuerdo', 80
) m
WHERE s.deleted_at IS NULL;
