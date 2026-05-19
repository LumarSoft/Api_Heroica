-- Migración RH-61: periodicidad y Ministerio en calendario RRHH
-- Fecha: 2026-05-04
--
-- Cambios:
--   • Agrega columna `periodicidad` a rrhh_calendario_eventos
--   • Actualiza el CHECK de eventos para incluir 'Ministerio'
--     (MySQL 8+ soporta CHECK; si no está habilitado el enum se gestiona a nivel app)

ALTER TABLE `rrhh_calendario_eventos`
  ADD COLUMN `periodicidad` varchar(50) DEFAULT NULL
    COMMENT 'Recurrencia del evento: Ninguna, Cada día, Lun-Vie, Cada semana, Cada 2 semanas, Cada mes, Primero de cada mes, Cada año'
  AFTER `tipo_notion`;
