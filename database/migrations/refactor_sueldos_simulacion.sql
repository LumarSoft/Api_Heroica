SET @schema_name = DATABASE();

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN aplica_valor_hora TINYINT(1) NOT NULL DEFAULT 1 AFTER anio',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'aplica_valor_hora'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN aplica_sueldo_basico_escala TINYINT(1) NOT NULL DEFAULT 1 AFTER aplica_valor_hora',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'aplica_sueldo_basico_escala'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN aplica_horas_extra TINYINT(1) NOT NULL DEFAULT 0 AFTER aplica_sueldo_basico_escala',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'aplica_horas_extra'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN aplica_incentivos TINYINT(1) NOT NULL DEFAULT 1 AFTER aplica_horas_extra',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'aplica_incentivos'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN aplica_banco TINYINT(1) NOT NULL DEFAULT 0 AFTER aplica_incentivos',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'aplica_banco'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN horas_extra_hs DECIMAL(10, 2) NULL DEFAULT NULL AFTER horas_extra_50',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'horas_extra_hs'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN horas_feriado DECIMAL(12, 2) NULL DEFAULT NULL AFTER horas_extra_hs',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'horas_feriado'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN incentivos_seleccionados TEXT NULL DEFAULT NULL AFTER incentivos',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'incentivos_seleccionados'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN horas_feriado_hs DECIMAL(10, 2) NULL DEFAULT NULL AFTER horas_feriado',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'horas_feriado_hs'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN sueldo_pagado TINYINT(1) NOT NULL DEFAULT 0 AFTER fecha_deposito',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'sueldo_pagado'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes ADD COLUMN comentario_cobro TEXT NULL DEFAULT NULL AFTER sueldo_pagado',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'comentario_cobro'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes DROP COLUMN locales_afectados',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'locales_afectados'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes DROP COLUMN link',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'link'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes DROP COLUMN presentismo_4',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'presentismo_4'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes DROP COLUMN buena_conducta_3',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'buena_conducta_3'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE rrhh_sueldos_periodo_ajustes DROP COLUMN objetivo_3',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'rrhh_sueldos_periodo_ajustes'
    AND COLUMN_NAME = 'objetivo_3'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
