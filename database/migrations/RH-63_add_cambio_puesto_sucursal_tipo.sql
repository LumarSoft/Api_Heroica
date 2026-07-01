-- Migración RH-63: Agregar tipo 'Cambio de puesto/sucursal' al enum de rrhh_solicitudes
-- Fecha: 2026-05-27

ALTER TABLE `rrhh_solicitudes`
  MODIFY COLUMN `tipo` enum(
    'Altas',
    'Bajas',
    'Novedades de sueldo',
    'Incentivos y premios',
    'Licencias',
    'Vacaciones',
    'Suspensiones',
    'Apercibimientos',
    'Capacitaciones',
    'Pedido de uniforme',
    'Adelantos',
    'Descuentos',
    'Horas extras',
    'Cambio de puesto/sucursal'
  ) NOT NULL;

-- Aseguramos que el enum de eventos del historial admita 'Puesto actualizado',
-- necesario al aprobar una solicitud de cambio (también lo usa Novedades de sueldo).
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
