-- Migración 013: Migrar datos de concepto → descripciones (tabla catálogo)
-- Fecha: 2026-04-14
-- Descripción: Toma cada valor único de `movimientos.concepto` y lo inserta en la tabla
--              `descripciones` (si aún no existe), luego actualiza `movimientos.descripcion_id`
--              apuntando al registro correspondiente.
--              Esto preserva la información histórica de concepto en el nuevo campo configurable.

-- ============================================================
-- Paso 1: Insertar en `descripciones` todos los conceptos únicos
--         que aún no existan como descripción
-- ============================================================

INSERT INTO `descripciones` (`nombre`, `activo`)
SELECT DISTINCT TRIM(m.concepto), 1
FROM `movimientos` m
WHERE m.concepto IS NOT NULL
  AND TRIM(m.concepto) != ''
  AND NOT EXISTS (
    SELECT 1 FROM `descripciones` d
    WHERE d.nombre = TRIM(m.concepto)
  );

-- ============================================================
-- Paso 2: Actualizar descripcion_id en movimientos
--         enlazando con la descripción cuyo nombre coincide con concepto
-- ============================================================

UPDATE `movimientos` m
JOIN `descripciones` d ON d.nombre = TRIM(m.concepto)
SET m.descripcion_id = d.id
WHERE m.concepto IS NOT NULL
  AND TRIM(m.concepto) != ''
  AND m.descripcion_id IS NULL;

-- ============================================================
-- Verificación (opcional, ejecutar para revisar el resultado)
-- ============================================================

-- Ver cuántos movimientos quedaron sin descripcion_id (deberían ser 0 si concepto siempre tiene valor):
-- SELECT COUNT(*) AS sin_descripcion FROM movimientos WHERE descripcion_id IS NULL AND concepto IS NOT NULL AND TRIM(concepto) != '';

-- Ver las nuevas descripciones generadas:
-- SELECT * FROM descripciones ORDER BY id;
