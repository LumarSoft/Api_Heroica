-- =====================================================
-- MIGRACIÓN: Agregar campo DEUDA a movimientos
-- Fecha: 2026-03-02
-- =====================================================

ALTER TABLE movimientos
  ADD COLUMN IF NOT EXISTS es_deuda TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Si es 1, el movimiento está en deuda y no contabiliza en saldo necesario',
  ADD COLUMN IF NOT EXISTS fecha_original_vencimiento DATE NULL
    COMMENT 'Fecha original de vencimiento antes de ser marcado como deuda';

-- Índice para filtrar rápido por deuda
CREATE INDEX IF NOT EXISTS idx_es_deuda ON movimientos (es_deuda);
