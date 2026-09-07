-- Migración RH-71: separar la escritura de sueldos de su permiso de lectura
--                   y hacer explícito el permiso del analítico global de RRHH
-- Fecha: 2026-09-07
--
-- Contexto:
--   Hasta ahora las cinco escrituras de /api/rrhh-sueldos (enviar-pagos, enviar-pagos de
--   liquidación, y los tres PUT de período/liquidación) estaban gateadas por 'ver_sueldos',
--   que es un permiso de LECTURA. Cualquiera que pudiera mirar el panel podía además
--   modificar novedades y enviar sueldos a pagos.
--   Y GET /api/rrhh-analitico/global no tenía ningún requirePermission: alcanzaba con
--   tener el módulo 'recursos_humanos'.
--
-- Qué hace esta migración:
--   1. Crea los permisos 'gestionar_sueldos' y 'ver_analitico_rrhh'.
--   2. 'gestionar_sueldos' → a todo rol que hoy tenga 'ver_sueldos'.
--   3. 'ver_analitico_rrhh' → a todo rol que hoy tenga algún permiso de categoría
--      'Recursos Humanos'. Esto reproduce el acceso actual (el analítico solo estaba
--      gateado por módulo) y responde a la decisión: "todos los que tengan permisos
--      para ver los módulos de recursos humanos".
--
--   Resultado: CERO cambio de comportamiento observable, siempre que esta migración se
--   aplique ANTES de desplegar el código. Al revés, los usuarios pierden el acceso.
--
--   Los superadmin no necesitan filas acá: bypassean todo control de permisos.
--
-- ⚠️ ORDEN DE DEPLOY OBLIGATORIO: primero esta migración, después el código.
--   syncPermisos() al arranque también crea los dos permisos (upsert por clave), pero
--   NO los asigna a ningún rol. La asignación es esta migración y solo esta.

-- ── 1. Crear los permisos ─────────────────────────────────────────────────
INSERT IGNORE INTO `permisos` (`clave`, `descripcion`, `categoria`) VALUES
  ('gestionar_sueldos',  'Modificar novedades, liquidaciones y enviar sueldos a pagos', 'Recursos Humanos'),
  ('ver_analitico_rrhh', 'Ver el analítico global de Recursos Humanos',                 'Recursos Humanos');

-- ── 2. gestionar_sueldos → roles que ya tienen ver_sueldos ────────────────
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT rp.rol_id, p_new.id
FROM `roles_permisos` rp
JOIN `permisos` p_old ON p_old.id = rp.permiso_id AND p_old.clave = 'ver_sueldos'
JOIN `permisos` p_new ON p_new.clave = 'gestionar_sueldos';

-- ── 3. ver_analitico_rrhh → roles con cualquier permiso de RRHH ───────────
INSERT IGNORE INTO `roles_permisos` (`rol_id`, `permiso_id`)
SELECT DISTINCT rp.rol_id, p_new.id
FROM `roles_permisos` rp
JOIN `permisos` p_old ON p_old.id = rp.permiso_id AND p_old.categoria = 'Recursos Humanos'
JOIN `permisos` p_new ON p_new.clave = 'ver_analitico_rrhh';

-- ── VERIFICACIÓN (correr después, solo lectura) ───────────────────────────
-- SELECT p.clave, r.nombre AS rol
-- FROM roles_permisos rp
-- JOIN permisos p ON p.id = rp.permiso_id
-- JOIN roles r ON r.id = rp.rol_id
-- WHERE p.clave IN ('ver_sueldos', 'gestionar_sueldos', 'ver_analitico_rrhh')
-- ORDER BY r.nombre, p.clave;

-- ROLLBACK:
-- DELETE rp FROM roles_permisos rp
--   JOIN permisos p ON p.id = rp.permiso_id
--   WHERE p.clave IN ('gestionar_sueldos', 'ver_analitico_rrhh');
-- DELETE FROM permisos WHERE clave IN ('gestionar_sueldos', 'ver_analitico_rrhh');
