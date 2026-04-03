--
-- Add deleted_at (soft delete) to all tables that don't have it yet
--

ALTER TABLE `bancos` ADD COLUMN `deleted_at` datetime DEFAULT NULL;
ALTER TABLE `categorias` ADD COLUMN `deleted_at` datetime DEFAULT NULL;
ALTER TABLE `subcategorias` ADD COLUMN `deleted_at` datetime DEFAULT NULL;
ALTER TABLE `medios_pago` ADD COLUMN `deleted_at` datetime DEFAULT NULL;
ALTER TABLE `movimientos` ADD COLUMN `deleted_at` datetime DEFAULT NULL;
ALTER TABLE `cuentas_bancarias_sucursal` ADD COLUMN `deleted_at` datetime DEFAULT NULL;
ALTER TABLE `documentos_sucursal` ADD COLUMN `deleted_at` datetime DEFAULT NULL;
ALTER TABLE `documentos_movimiento` ADD COLUMN `deleted_at` datetime DEFAULT NULL;
ALTER TABLE `roles` ADD COLUMN `deleted_at` datetime DEFAULT NULL;