-- =====================================================================
-- 024_performance_indexes.sql
-- Índices de performance derivados de los patrones de consulta reales
-- del API (movimientos, reportes, export, pagos pendientes, tareas,
-- auth y RRHH).
--
-- Ejecutar en heroica_oficial. La base heroica_prueba se regenera sola
-- vía dbSyncService (CREATE TABLE ... LIKE copia los índices).
--
-- Todo es aditivo salvo dos DROP INDEX explícitamente justificados.
-- No borra ni modifica datos. ~1-2 s sobre movimientos (7k filas);
-- instantáneo sobre las tablas de RRHH que todavía están vacías.
--
-- NOTA: los índices de una sola columna sobre FKs (categoria_id,
-- banco_id, proveedor_id, etc.) NO se pueden borrar aunque parezcan
-- redundantes: InnoDB los exige para sostener el FOREIGN KEY.
-- =====================================================================


-- =====================================================================
-- MOVIMIENTOS
-- Tabla caliente: 7.000 filas y creciendo, 1,5 MB de los 1,7 MB del
-- dump. Ya tiene 14 índices, pero 12 son de una sola columna (11 de
-- ellos creados automáticamente por los FOREIGN KEY). El único
-- compuesto, idx_sucursal_tipo, cubre 2 de las 4 columnas que filtran
-- las consultas de caja.
-- =====================================================================

-- getMovimientosBySucursal + getMovimientosBanco + getTotalesEfectivo
-- + getTotalesBanco:
--   WHERE sucursal_id=? AND tipo_movimiento=? AND moneda=? AND deleted_at IS NULL
--   ORDER BY id DESC
-- Con `id` al final el ORDER BY se resuelve leyendo el índice en orden,
-- sin filesort.
ALTER TABLE `movimientos`
  ADD INDEX `idx_mov_caja` (`sucursal_id`, `tipo_movimiento`, `moneda`, `deleted_at`, `id`);

-- getReportesBySucursal + getReportesAnual + exportación a Excel:
--   WHERE sucursal_id=? AND moneda=? AND deleted_at IS NULL
--         AND estado IN ('completado','aprobado') ... ORDER BY fecha DESC
ALTER TABLE `movimientos`
  ADD INDEX `idx_mov_reporte` (`sucursal_id`, `moneda`, `deleted_at`, `estado`, `fecha`);

-- getDeudasInterSucursal + paneles de deuda/crédito de reportes:
--   WHERE sucursal_id=? AND es_deuda=1 AND tipo=? AND estado != 'completado'
ALTER TABLE `movimientos`
  ADD INDEX `idx_mov_deuda` (`sucursal_id`, `es_deuda`, `tipo`, `estado`);

-- getPagosPendientes (bandeja global, SIN sucursal_id):
--   WHERE estado='pendiente' AND (tipo='egreso' OR tipo IS NULL)
--         AND deleted_at IS NULL ORDER BY fecha DESC
-- Este índice es la razón por la que se puede borrar idx_estado más
-- abajo: es el único acceso al que `estado` le sirve como primera
-- columna, y acá va acompañado del resto del filtro.
ALTER TABLE `movimientos`
  ADD INDEX `idx_mov_pendientes` (`estado`, `deleted_at`, `tipo`, `fecha`);

-- getHistorialPagos — lo consulta el polling de empleados cada 30 s:
--   WHERE estado IN (...) AND usuario_revisor_id IS NOT NULL
--         AND deleted_at IS NULL AND user_id=? ORDER BY id DESC
ALTER TABLE `movimientos`
  ADD INDEX `idx_mov_historial` (`user_id`, `deleted_at`, `estado`, `id`);

-- Índices de baja selectividad, ya cubiertos por los compuestos de
-- arriba. `estado` tiene 4 valores posibles y `es_deuda` sólo 2: MySQL
-- prácticamente nunca los elige, pero encarecen cada INSERT y UPDATE.
-- (No son columnas de FK, así que se pueden borrar sin romper nada.)
ALTER TABLE `movimientos` DROP INDEX `idx_es_deuda`;
ALTER TABLE `movimientos` DROP INDEX `idx_estado`;

-- idx_fecha se conserva: sostiene los filtros por rango de fecha de
-- reportes y exportación cuando el optimizador no elige el compuesto.


-- =====================================================================
-- CATÁLOGOS
-- Se piden en cada carga de caja (6 fetch en paralelo desde
-- use-caja-data.ts) y ninguno tiene índice sobre activo / deleted_at.
-- =====================================================================

ALTER TABLE `descripciones`
  ADD INDEX `idx_descripciones_activas` (`deleted_at`, `activo`, `tipo`);

ALTER TABLE `proveedores`
  ADD INDEX `idx_proveedores_activo` (`activo`, `nombre`);

ALTER TABLE `categorias`
  ADD INDEX `idx_categorias_activas` (`deleted_at`, `activo`, `tipo`);

ALTER TABLE `subcategorias`
  ADD INDEX `idx_subcategorias_activas` (`categoria_id`, `deleted_at`, `activo`);

ALTER TABLE `bancos`
  ADD INDEX `idx_bancos_activo` (`deleted_at`, `activo`);

ALTER TABLE `medios_pago`
  ADD INDEX `idx_medios_pago_activo` (`deleted_at`, `activo`);


-- =====================================================================
-- USUARIOS / SUCURSALES / AUTH
-- =====================================================================

ALTER TABLE `usuarios`
  ADD INDEX `idx_usuarios_activos` (`deleted_at`, `activo`);

ALTER TABLE `sucursales`
  ADD INDEX `idx_sucursales_activas` (`deleted_at`, `activo`);

-- getDispositivosConfianza:
--   WHERE usuario_id=? AND revocado=0 AND expires_at > NOW()
-- (el login por device_token ya usa el UNIQUE uq_token_hash, que es
-- óptimo — no hace falta tocarlo)
ALTER TABLE `dispositivos_confianza`
  ADD INDEX `idx_dc_usuario_vigente` (`usuario_id`, `revocado`, `expires_at`);


-- =====================================================================
-- TAREAS
-- =====================================================================

-- Listado del tablero: WHERE t.deleted_at IS NULL ORDER BY estado...
ALTER TABLE `tareas`
  ADD INDEX `idx_tareas_activas` (`deleted_at`, `estado`);

-- El listado de tareas trae comentarios_count con una subconsulta
-- correlacionada que se ejecuta UNA VEZ POR TAREA:
--   (SELECT COUNT(*) FROM tareas_comentarios tc
--    WHERE tc.tarea_id = t.id AND tc.deleted_at IS NULL)
-- El índice actual sólo tiene tarea_id.
ALTER TABLE `tareas_comentarios`
  ADD INDEX `idx_comentarios_tarea_activos` (`tarea_id`, `deleted_at`);

-- Campana del sidebar, polling cada 30 s por usuario:
--   WHERE para_usuario_id=? [AND leida=0] ORDER BY created_at DESC
ALTER TABLE `tareas_notificaciones`
  ADD INDEX `idx_notif_usuario_leida` (`para_usuario_id`, `leida`, `created_at`);


-- =====================================================================
-- RRHH
-- Tablas todavía vacías o casi, pero los patrones de consulta ya están
-- fijados en el código. Crearlos ahora sale gratis; hacerlo con datos
-- adentro no.
-- =====================================================================

-- El más importante de este bloque. rrhhSueldosController resuelve el
-- sueldo base y el valor hora con subconsultas correlacionadas que
-- corren 3-4 VECES POR EMPLEADO del listado:
--   SELECT es.sueldo_base FROM escalas_salariales es
--   WHERE es.puesto_id=? AND es.sucursal_id=? AND es.deleted_at IS NULL
--   ORDER BY es.anio DESC, es.mes DESC LIMIT 1
-- Ninguno de los tres índices actuales (idx_periodo, escalas_puesto_fk,
-- idx_sucursal_periodo) empieza por puesto_id + sucursal_id.
ALTER TABLE `escalas_salariales`
  ADD INDEX `idx_escalas_vigente` (`puesto_id`, `sucursal_id`, `deleted_at`, `anio`, `mes`);

ALTER TABLE `rrhh_solicitudes`
  ADD INDEX `idx_solicitudes_bandeja` (`sucursal_id`, `deleted_at`, `estado`, `fecha_solicitud`);

ALTER TABLE `rrhh_solicitudes`
  ADD INDEX `idx_solicitudes_tipo` (`tipo`, `estado`);

ALTER TABLE `personal`
  ADD INDEX `idx_personal_sucursal_activo` (`sucursal_id`, `deleted_at`, `activo`);

ALTER TABLE `personal_notas`
  ADD INDEX `idx_personal_notas_listado` (`personal_id`, `deleted_at`, `created_at`);

ALTER TABLE `personal_documentos`
  ADD INDEX `idx_personal_documentos_listado` (`personal_id`, `deleted_at`);

ALTER TABLE `rrhh_calendario_eventos`
  ADD INDEX `idx_calendario_rango` (`deleted_at`, `fecha`);


-- =====================================================================
-- BLOQUE OPCIONAL 1 — Foreign keys faltantes
--
-- personal_documentos y personal_notas se crearon sin ninguna FK. Hoy
-- un DELETE sobre personal deja documentos y notas huérfanos apuntando
-- a un id inexistente.
--
-- Verificar primero que no haya huérfanos. Ambas deben devolver 0:
--
--   SELECT COUNT(*) FROM personal_documentos d
--     LEFT JOIN personal p ON p.id = d.personal_id WHERE p.id IS NULL;
--   SELECT COUNT(*) FROM personal_notas n
--     LEFT JOIN personal p ON p.id = n.personal_id WHERE p.id IS NULL;
--
-- personal_documentos además está en utf8mb3: conviene correr el
-- bloque 2 antes que este.
-- =====================================================================

-- ALTER TABLE `personal_documentos`
--   ADD CONSTRAINT `fk_personal_documentos_personal`
--   FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE CASCADE;

-- ALTER TABLE `personal_notas`
--   ADD CONSTRAINT `fk_personal_notas_personal`
--   FOREIGN KEY (`personal_id`) REFERENCES `personal` (`id`) ON DELETE CASCADE;


-- =====================================================================
-- BLOQUE OPCIONAL 2 — Charset
--
-- Tres tablas quedaron en utf8mb3 mientras el resto del esquema es
-- utf8mb4. Consecuencias reales: tareas.titulo y tareas.descripcion no
-- pueden guardar emojis, y cualquier JOIN por varchar contra una tabla
-- utf8mb4 fuerza conversión de charset e invalida el índice.
--
-- Va aparte porque reescribe la tabla completa. Correr en ventana de
-- baja actividad y con backup fresco.
-- =====================================================================

-- ALTER TABLE `tareas`                 CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- ALTER TABLE `personal_documentos`    CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- ALTER TABLE `dispositivos_confianza` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- =====================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
--
--   SHOW INDEX FROM movimientos;
--
--   EXPLAIN SELECT id FROM movimientos
--    WHERE sucursal_id=1 AND tipo_movimiento='efectivo'
--      AND moneda='ARS' AND deleted_at IS NULL
--    ORDER BY id DESC;
--   -- esperado: key = idx_mov_caja, Extra SIN "Using filesort"
--
--   EXPLAIN SELECT id FROM movimientos
--    WHERE estado='pendiente' AND deleted_at IS NULL
--    ORDER BY fecha DESC;
--   -- esperado: key = idx_mov_pendientes
-- =====================================================================
