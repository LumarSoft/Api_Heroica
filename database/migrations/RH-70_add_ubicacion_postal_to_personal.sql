-- Migración RH-70: ubicación postal del colaborador
-- El código provincial corresponde a la primera letra del CPA de Correo Argentino.

ALTER TABLE `personal`
  ADD COLUMN `domicilio_real_provincia_codigo` CHAR(1) DEFAULT NULL AFTER `domicilio_dni`,
  ADD COLUMN `domicilio_real_localidad` VARCHAR(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `domicilio_real_provincia_codigo`,
  ADD COLUMN `domicilio_real_codigo_postal` CHAR(4) DEFAULT NULL AFTER `domicilio_real_localidad`,
  ADD COLUMN `domicilio_dni_provincia_codigo` CHAR(1) DEFAULT NULL AFTER `domicilio_real_codigo_postal`,
  ADD COLUMN `domicilio_dni_localidad` VARCHAR(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `domicilio_dni_provincia_codigo`,
  ADD COLUMN `domicilio_dni_codigo_postal` CHAR(4) DEFAULT NULL AFTER `domicilio_dni_localidad`;
