-- Migración 028: vuelve a habilitar Bistrosoft junto a Hiopos.
-- Fecha: 2026-10-08
-- Requiere: 027_ventas_hiopos.sql
--
-- Solo hace falta en bases donde se corrió la versión anterior de la 027, que borraba lo
-- importado de Bistrosoft y dejaba `fuente` = ENUM('hiopos'). En una base nueva
-- (026 → 027 → 028) no cambia nada. Se puede correr más de una vez.
--
-- Lo borrado de Bistrosoft no se recupera con SQL: se vuelve a traer desde
-- Ventas → Integraciones → Sincronizar (Bistrosoft), por rango de fechas.

-- Fila inválida que pudo quedar al insertar 'bistrosoft' con el ENUM todavía angosto.
DELETE FROM `ventas_fuentes_estado` WHERE `fuente` = '';

ALTER TABLE `ventas_locales_externos` MODIFY `fuente` ENUM('bistrosoft','hiopos') NOT NULL;
ALTER TABLE `ventas_sincronizaciones` MODIFY `fuente` ENUM('bistrosoft','hiopos') NOT NULL;
ALTER TABLE `ventas_lineas` MODIFY `fuente` ENUM('bistrosoft','hiopos') NOT NULL;
ALTER TABLE `ventas_dias_sincronizados` MODIFY `fuente` ENUM('bistrosoft','hiopos') NOT NULL;
ALTER TABLE `ventas_fuentes_estado` MODIFY `fuente` ENUM('bistrosoft','hiopos') NOT NULL;

INSERT IGNORE INTO `ventas_fuentes_estado` (`fuente`) VALUES ('bistrosoft'), ('hiopos');

-- Vinculación conocida del local de Bistrosoft cuyo nombre no coincide con la sucursal
-- (la versión anterior de la 027 la borró). Si ya existe, no se toca.
INSERT IGNORE INTO `ventas_locales_externos` (`fuente`, `codigo_externo`, `nombre_externo`, `sucursal_id`, `asignacion`)
SELECT 'bistrosoft', '11112935', 'HEROICA CORDOBA SHOPPING', s.`id`, 'automatica'
FROM `sucursales` s
WHERE s.`nombre` = 'Heroica Alto Córdoba' AND s.`deleted_at` IS NULL
LIMIT 1;

UPDATE `permisos`
SET `descripcion` = 'Configurar las integraciones de ventas (Bistrosoft, Hiopos) y asignar locales a sucursales'
WHERE `clave` = 'configurar_ventas';
