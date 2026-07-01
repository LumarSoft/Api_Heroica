-- RH-LiqFinal: integración con Calendario (agenda Ministerio) y envío a Pagos Pendientes
ALTER TABLE `rrhh_liquidaciones_finales_ajustes`
  ADD COLUMN `calendario_evento_id` int DEFAULT NULL AFTER `ministerio_horario`,
  ADD COLUMN `enviado_pagos` tinyint(1) NOT NULL DEFAULT 0 AFTER `calendario_evento_id`,
  ADD COLUMN `fecha_enviado_pagos` datetime DEFAULT NULL AFTER `enviado_pagos`,
  ADD COLUMN `movimiento_banco_id` int DEFAULT NULL AFTER `fecha_enviado_pagos`,
  ADD COLUMN `movimiento_efectivo_id` int DEFAULT NULL AFTER `movimiento_banco_id`;
