-- Migración 031: Préstamos entre sucursales
-- Fecha: 2026-10-21
-- Descripción: reemplaza las deudas que generaba "Mover" + "Es Crédito". Un préstamo es plata que
--              pasa de la caja de una sucursal a la de otra; una devolución es plata que vuelve.
--              Ninguno es gasto ni ingreso del negocio, por eso sus movimientos llevan
--              origen = 'prestamo' y quedan fuera de reportes y del corte de balance.
--
--   Flujo:
--     * La sucursal que necesita plata carga el pedido ("solicitado"). No mueve saldos.
--     * La sucursal que presta lo acepta desde su caja: se crean un egreso en ella y un
--       ingreso en la que pidió, los dos en Saldo Real, y el préstamo queda "vigente".
--     * Las devoluciones (totales o parciales) siguen el mismo camino ("por_confirmar" →
--       "confirmada"). Pendiente = monto - devoluciones confirmadas.
--     * Si quien carga ya puede aprobar en la otra sucursal, se registra directo.
--
--   Numerada 031: 029 y 030 ya están en producción y dev usa 026-028.

CREATE TABLE IF NOT EXISTS `prestamos_sucursales` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sucursal_presta_id` INT NOT NULL,
  `sucursal_recibe_id` INT NOT NULL,
  `monto` DECIMAL(15,2) NOT NULL,
  `moneda` ENUM('ARS','USD') NOT NULL DEFAULT 'ARS',
  `descripcion` VARCHAR(255) DEFAULT NULL,
  `estado` ENUM('solicitado','vigente','cancelado','rechazado','anulado') NOT NULL DEFAULT 'solicitado',
  `es_apertura` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = saldo inicial migrado de las deudas viejas, sin movimientos',
  `fecha_solicitud` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fecha` DATE DEFAULT NULL COMMENT 'Fecha en que se movió la plata (al aceptar)',
  `caja_salida` ENUM('efectivo','banco') NOT NULL,
  `banco_salida_id` INT DEFAULT NULL,
  `caja_entrada` ENUM('efectivo','banco') NOT NULL,
  `banco_entrada_id` INT DEFAULT NULL,
  `user_solicita_id` INT NOT NULL,
  `user_resuelve_id` INT DEFAULT NULL,
  `resuelto_at` DATETIME DEFAULT NULL,
  `motivo_rechazo` VARCHAR(255) DEFAULT NULL,
  `movimiento_salida_id` INT DEFAULT NULL,
  `movimiento_entrada_id` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_prestamo_presta` (`sucursal_presta_id`, `estado`),
  KEY `idx_prestamo_recibe` (`sucursal_recibe_id`, `estado`),
  CONSTRAINT `fk_prestamo_presta` FOREIGN KEY (`sucursal_presta_id`) REFERENCES `sucursales` (`id`),
  CONSTRAINT `fk_prestamo_recibe` FOREIGN KEY (`sucursal_recibe_id`) REFERENCES `sucursales` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `prestamos_devoluciones` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `prestamo_id` INT NOT NULL,
  `monto` DECIMAL(15,2) NOT NULL,
  `estado` ENUM('por_confirmar','confirmada','rechazada','anulada') NOT NULL DEFAULT 'por_confirmar',
  `fecha` DATE NOT NULL,
  `caja_salida` ENUM('efectivo','banco') NOT NULL,
  `banco_salida_id` INT DEFAULT NULL,
  `caja_entrada` ENUM('efectivo','banco') NOT NULL,
  `banco_entrada_id` INT DEFAULT NULL,
  `user_solicita_id` INT NOT NULL,
  `user_resuelve_id` INT DEFAULT NULL,
  `resuelto_at` DATETIME DEFAULT NULL,
  `motivo_rechazo` VARCHAR(255) DEFAULT NULL,
  `movimiento_salida_id` INT DEFAULT NULL,
  `movimiento_entrada_id` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_devolucion_prestamo` (`prestamo_id`, `estado`),
  CONSTRAINT `fk_devolucion_prestamo` FOREIGN KEY (`prestamo_id`) REFERENCES `prestamos_sucursales` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los movimientos que genera un préstamo se marcan para excluirlos de reportes y para que no se
-- editen ni borren desde la caja (se anulan desde el préstamo).
ALTER TABLE `movimientos`
  MODIFY COLUMN `origen` ENUM('manual','importacion','prestamo') NOT NULL DEFAULT 'manual';
