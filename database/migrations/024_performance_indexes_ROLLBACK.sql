-- =====================================================================
-- ROLLBACK de 024_performance_indexes.sql
--
-- Deja la base exactamente como estaba antes de la migración: borra los
-- 22 índices agregados y recrea los 2 que se habían eliminado.
--
-- No toca datos. Es seguro correrlo con el sistema en uso.
-- =====================================================================

ALTER TABLE `movimientos` DROP INDEX `idx_mov_caja`;
ALTER TABLE `movimientos` DROP INDEX `idx_mov_reporte`;
ALTER TABLE `movimientos` DROP INDEX `idx_mov_deuda`;
ALTER TABLE `movimientos` DROP INDEX `idx_mov_pendientes`;
ALTER TABLE `movimientos` DROP INDEX `idx_mov_historial`;

ALTER TABLE `movimientos` ADD INDEX `idx_estado` (`estado`);
ALTER TABLE `movimientos` ADD INDEX `idx_es_deuda` (`es_deuda`);

ALTER TABLE `descripciones` DROP INDEX `idx_descripciones_activas`;
ALTER TABLE `proveedores` DROP INDEX `idx_proveedores_activo`;
ALTER TABLE `categorias` DROP INDEX `idx_categorias_activas`;
ALTER TABLE `subcategorias` DROP INDEX `idx_subcategorias_activas`;
ALTER TABLE `bancos` DROP INDEX `idx_bancos_activo`;
ALTER TABLE `medios_pago` DROP INDEX `idx_medios_pago_activo`;

ALTER TABLE `usuarios` DROP INDEX `idx_usuarios_activos`;
ALTER TABLE `sucursales` DROP INDEX `idx_sucursales_activas`;
ALTER TABLE `dispositivos_confianza` DROP INDEX `idx_dc_usuario_vigente`;

ALTER TABLE `tareas` DROP INDEX `idx_tareas_activas`;
ALTER TABLE `tareas_comentarios` DROP INDEX `idx_comentarios_tarea_activos`;
ALTER TABLE `tareas_notificaciones` DROP INDEX `idx_notif_usuario_leida`;

ALTER TABLE `escalas_salariales` DROP INDEX `idx_escalas_vigente`;
ALTER TABLE `rrhh_solicitudes` DROP INDEX `idx_solicitudes_bandeja`;
ALTER TABLE `rrhh_solicitudes` DROP INDEX `idx_solicitudes_tipo`;
ALTER TABLE `personal` DROP INDEX `idx_personal_sucursal_activo`;
ALTER TABLE `personal_notas` DROP INDEX `idx_personal_notas_listado`;
ALTER TABLE `personal_documentos` DROP INDEX `idx_personal_documentos_listado`;
ALTER TABLE `rrhh_calendario_eventos` DROP INDEX `idx_calendario_rango`;
