-- RH-Sueldos: Envío de sueldos del período a Pagos Pendientes (impacto definitivo)
-- Marca cada ajuste de sueldo como "enviado" e inmoviliza el período,
-- guardando la referencia a los movimientos generados en banco/efectivo.

ALTER TABLE `rrhh_sueldos_periodo_ajustes`
  ADD COLUMN `enviado_pagos` tinyint(1) NOT NULL DEFAULT 0 AFTER `comentario_cobro`,
  ADD COLUMN `fecha_enviado_pagos` datetime DEFAULT NULL AFTER `enviado_pagos`,
  ADD COLUMN `movimiento_banco_id` int DEFAULT NULL AFTER `fecha_enviado_pagos`,
  ADD COLUMN `movimiento_efectivo_id` int DEFAULT NULL AFTER `movimiento_banco_id`;
