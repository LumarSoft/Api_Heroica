-- Migración RH-24: ampliar eventos del historial de solicitudes RRHH
-- Fecha: 2026-04-29

ALTER TABLE `rrhh_solicitudes_historial`
  MODIFY COLUMN `evento` enum(
    'Creada',
    'Editada',
    'Aprobada',
    'Rechazada',
    'Cancelada',
    'Legajo creado',
    'Legajo desactivado',
    'Liquidacion final generada',
    'Error de liquidacion final'
  ) NOT NULL;
