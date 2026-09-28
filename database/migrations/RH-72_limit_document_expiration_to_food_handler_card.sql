-- Sólo el carnet de manipulación de alimentos tiene vencimiento en el legajo.
-- Limpia fechas históricas cargadas por error en constancias de alta u otros documentos.
UPDATE personal_documentos
SET fecha_vencimiento = NULL
WHERE (tipo_doc IS NULL OR tipo_doc <> 'carnet_manipulacion_alimentos')
  AND fecha_vencimiento IS NOT NULL;
