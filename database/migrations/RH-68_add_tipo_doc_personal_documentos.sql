ALTER TABLE personal_documentos
  ADD COLUMN tipo_doc VARCHAR(100) NULL AFTER label,
  ADD INDEX idx_personal_documentos_tipo_doc (personal_id, tipo_doc, deleted_at);
