-- Crear tabla para documentos asociados a movimientos (comprobantes)
CREATE TABLE `documentos_movimiento` (
  `id` int NOT NULL AUTO_INCREMENT,
  `movimiento_id` int NOT NULL,
  `nombre_archivo` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `ruta_archivo` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tipo_archivo` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tamano_bytes` int DEFAULT NULL,
  `fecha_subida` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `usuario_subida_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_movimiento` (`movimiento_id`),
  KEY `usuario_subida_id` (`usuario_subida_id`),
  CONSTRAINT `documentos_movimiento_ibfk_1` FOREIGN KEY (`movimiento_id`) REFERENCES `movimientos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `documentos_movimiento_ibfk_2` FOREIGN KEY (`usuario_subida_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
