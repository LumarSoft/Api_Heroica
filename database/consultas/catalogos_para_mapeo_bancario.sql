-- ============================================================
--  CATÁLOGOS — diagnóstico para el mapeo de importación bancaria
-- ============================================================
--  Correr en la base que usa la API y pegar el resultado completo.
--
--  Devuelve un solo result set, una fila por valor, en el formato exacto que
--  necesitan las reglas de `adapters/<banco>Reglas.ts`:
--
--    CATEGORIA     | Egresos
--    SUBCATEGORIA  | Egresos > Financiero
--    DESCRIPCION   | Cobranza Nave
--    MEDIO_PAGO    | Debito automatico
--
--  Las subcategorías salen con el prefijo de su categoría porque el resolutor
--  las busca por el par (categoría, subcategoría): una subcategoría correcta
--  colgada de una categoría mal escrita no matchea.
--
--  El match ignora mayúsculas y tildes, así que "Debito automatico" encuentra
--  a "Débito Automático". Lo que sí importa es el singular/plural y el texto.
-- ============================================================

SELECT 'CATEGORIA' AS tipo, c.id, c.nombre AS valor, c.tipo AS detalle
FROM categorias c
WHERE c.deleted_at IS NULL

UNION ALL

SELECT 'SUBCATEGORIA', s.id, CONCAT(c.nombre, ' > ', s.nombre), c.tipo
FROM subcategorias s
JOIN categorias c ON s.categoria_id = c.id AND c.deleted_at IS NULL
WHERE s.deleted_at IS NULL

UNION ALL

SELECT 'DESCRIPCION', d.id, d.nombre, COALESCE(d.tipo, '')
FROM descripciones d
WHERE d.deleted_at IS NULL

UNION ALL

SELECT 'MEDIO_PAGO', mp.id, mp.nombre, ''
FROM medios_pago mp
WHERE mp.deleted_at IS NULL

ORDER BY tipo, valor;
