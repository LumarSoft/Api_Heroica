-- Migración RH-62: Agregar evento 'Puesto actualizado' al historial de solicitudes RRHH
-- Fecha: 2026-05-08
--
-- Necesario para que la aprobación de una "Novedad de sueldo" con cambio_puesto=true
-- pueda registrar el cambio en rrhh_solicitudes_historial.

ALTER TABLE `rrhh_solicitudes_historial`
  MODIFY COLUMN `evento` enum(
    'Creada',
    'Editada',
    'Aprobada',
    'Rechazada',
    'Cancelada',
    'Legajo creado',
    'Legajo desactivado',
    'Puesto actualizado',
    'Liquidacion final generada',
    'Error de liquidacion final'
  ) NOT NULL;
