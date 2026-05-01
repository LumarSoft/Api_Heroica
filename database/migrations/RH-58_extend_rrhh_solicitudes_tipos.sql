-- Migración RH-58: Agregar tipos 'Descuentos' y 'Horas extras' al enum de rrhh_solicitudes
-- Fecha: 2026-04-30

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
    'Horas extras'
  ) NOT NULL;
