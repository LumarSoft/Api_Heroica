ALTER TABLE personal_documentos
  ADD COLUMN fecha_vencimiento DATE NULL AFTER nombre_original,
  ADD INDEX idx_personal_documentos_vencimiento (fecha_vencimiento);
